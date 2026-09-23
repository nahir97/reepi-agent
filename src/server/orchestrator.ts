import { hashContent } from '../shared/ids.ts';
import {
  calibrate,
  estimateMessages,
  estimateTokens,
  DEFAULT_CALIBRATION,
  type Calibration,
} from '../shared/tokens.ts';
import { costOf, coldCostOf, isPeak, hitRate, cacheMultiplier, savedBy } from '../shared/cost.ts';
import type {
  ChatRequest,
  LoreHit,
  Memory,
  Message,
  ModelId,
  PayloadPlan,
  ReasoningEffort,
  Scene,
  StreamEvent,
  Story,
} from '../shared/types.ts';
import {
  castOf,
  ledger,
  lore,
  memories,
  messages,
  notes,
  prefixes,
  resolvePersona,
  scenes,
  settings,
  stories,
  threads,
  warmups,
} from './store/index.ts';
import { compose, type Composed, type ComposerInput, type PassSpec } from './composer.ts';
import { transaction } from './db.ts';
import { extractTerms, resolveLore, scanWindow } from './lorebook.ts';
import { streamChat, type WireMessage, type WireTool } from './deepseek.ts';
import {
  activeScene,
  directorMode,
  personaNameFor,
  runArchivist,
  runConductor,
  runDirector,
} from './agents.ts';
import { DIRECTOR_INLINE_TOOLS, applyInlineTool } from './director-tools.ts';

/**
 * The turn engine.
 *
 * Owns everything between "the writer pressed send" and "a new message row exists
 * with real usage attached": transcript assembly, lore and memory resolution,
 * payload composition, streaming, cache accounting, calibration feedback, and the
 * cost ledger.
 *
 * `composeTurn` is the **single** payload builder. The dry-run meter (`/plan`),
 * cache warming (`/warm`) and the real stream (`/chat`) all call it, so the
 * payload the writer is shown is byte-identical to the payload that gets sent.
 * That is a correctness property, not a nicety: a meter that disagrees with
 * reality is worse than no meter.
 *
 * Two cost mechanisms live here and nowhere else:
 *
 * 1. **Trim hysteresis** (see `planTrim`). The transcript block sits mid-payload,
 *    so any change to it invalidates itself and every later block. Dropping one
 *    message at a time would churn the payload almost every turn; instead a whole
 *    slab is dropped at once, down to a low-water mark, so the block is rewritten
 *    every dozen turns rather than every turn.
 *
 * 2. **Sampling-parameter-only variants.** A swipe re-sends an identical payload
 *    with a different temperature, so the second and later variants pay cache-hit
 *    prices for their entire input.
 */

const CALIBRATION_KEY = 'token.calibration';
const WATERMARK_PREFIX = 'trim.watermark:';

type Emit = (event: StreamEvent) => void;

export function readCalibration(): Calibration {
  return settings.get<Calibration | null>(CALIBRATION_KEY, null) ?? DEFAULT_CALIBRATION;
}

/** Fold an observed prompt-token count back into the estimator. */
function learnCalibration(promptTokens: number, rawEstimate: number): void {
  const before = readCalibration();
  const after = calibrate(before, rawEstimate, promptTokens);
  if (after !== before) settings.set(CALIBRATION_KEY, after);
}

/**
 * How many leading messages the transcript should drop this turn.
 *
 * Drop decisions are **windowed**, not total-based: what matters is the size of
 * the window actually being sent, not the size of the whole story. (Measuring the
 * total would make the answer grow every turn forever, re-trimming and rewriting
 * the history block on every request — the exact churn this exists to prevent.)
 *
 * Once the window is over budget we drop all the way to a low-water mark in one
 * step, so the following turns reuse the identical window and the cached prefix
 * survives.
 */
function planTrim(storyId: string, tokensPerMessage: readonly number[], budget: number): number {
  const count = tokensPerMessage.length;
  // Never trim below two messages: the narrator needs something to work from.
  const maxDrop = Math.max(0, count - 2);
  const applied = Math.min(settings.get<number>(`${WATERMARK_PREFIX}${storyId}`, 0), maxDrop);

  let windowTokens = 0;
  for (let index = applied; index < count; index += 1) {
    windowTokens += tokensPerMessage[index] ?? 0;
  }
  if (windowTokens <= budget) return applied;

  // Over budget: keep the newest messages that fit the low-water mark, and drop
  // everything before them in a single jump.
  const lowWater = Math.floor(budget * 0.82);
  let kept = 0;
  let accumulated = 0;
  for (let index = count - 1; index >= 0 && kept < count - 2; index -= 1) {
    accumulated += tokensPerMessage[index] ?? 0;
    if (accumulated > lowWater && kept > 0) break;
    kept += 1;
  }
  return Math.max(0, count - kept);
}

/* ---------------------------------------------------------------- compose */

export type TurnPayload = {
  messages: WireMessage[];
  plan: PayloadPlan;
  composed: Composed;
  model: ModelId;
  effort: ReasoningEffort;
  temperature: number;
  topP: number;
  maxTokens: number;
  targetWords: number;
};

/**
 * The story context every payload starts from: the story, the scene, the
 * transcript window, and the lore that window resolves.
 *
 * It exists in one function because it now has two callers that **must** agree to
 * the token. A narration turn and an agentic pass share a cache unit only while
 * every byte in front of the pass's brief is identical, and the transcript window
 * is the biggest thing in front of it — so the trim, the pinned survivors and the
 * lore resolution are not a narration concern that a pass can approximate. A pass
 * that computed its own window would silently miss by the length of the block it
 * disagreed about.
 *
 * `immediate` is the text that may trigger lore but is not in the transcript yet —
 * the writer's in-flight turn. A pass passes none: it has no turn of its own, and
 * its caller is composing it between turns rather than mid-sentence.
 */
type TurnContext = {
  story: Story;
  scene: Scene;
  history: Message[];
  droppedCount: number;
  loreHits: LoreHit[];
  transcriptTexts: string[];
};

function readTurnContext(input: {
  storyId: string;
  sceneId?: string | undefined;
  /** Stop before this message — how a regenerate sees the turn it replaces. */
  messageId?: string | undefined;
  immediate?: string[];
}): TurnContext | null {
  const story = stories.get(input.storyId);
  if (!story) return null;
  const scene = input.sceneId
    ? (scenes.get(input.sceneId) ?? activeScene(story.id))
    : activeScene(story.id);
  if (!scene) return null;

  /* Transcript window, with hysteresis. */

  const all = messages.list(story.id, scene.id).filter((message) => !message.disabled);
  /* A regenerate replaces one turn, so its context is the transcript **before** that
     turn: the message and everything after it are not part of the request. Keeping
     the later turns would ask the model for a beat that follows *them* rather than a
     replacement for this one. Every other verb sees the whole scene. */
  const cut = input.messageId ? all.findIndex((message) => message.id === input.messageId) : -1;
  const live = (cut >= 0 ? all.slice(0, cut) : all).filter(
    (message) => (message.variants[message.activeVariant] ?? '').trim().length > 0,
  );

  const calibration = readCalibration();
  const tokensPerMessage = live.map(
    (message) => estimateTokens(message.variants[message.activeVariant] ?? '', calibration) + 8,
  );
  const dropCount = planTrim(story.id, tokensPerMessage, story.historyBudget);
  const keepFrom = Math.min(Math.max(0, dropCount), Math.max(0, live.length - 2));
  let history = live.slice(keepFrom);

  // Pinned messages are inside the cache prefix by definition, so they survive.
  const pinnedBack = live.slice(0, keepFrom).filter((message) => message.pinned);
  if (pinnedBack.length > 0) history = [...pinnedBack, ...history];

  const droppedCount = live.length - history.length;
  /* Idempotent: a turn and the pass that follows it compute the same window and
     write the same watermark, so the second write is a no-op rather than a
     re-decision. */
  if (keepFrom !== settings.get<number>(`${WATERMARK_PREFIX}${story.id}`, 0)) {
    settings.set(`${WATERMARK_PREFIX}${story.id}`, keepFrom);
  }

  /* Lore — resolved locally, no API spend. */

  const transcriptTexts = history.map((message) => message.variants[message.activeVariant] ?? '');
  const resolved = resolveLore({
    entries: lore.list(story.id),
    recent: scanWindow(transcriptTexts),
    immediate: input.immediate ?? [],
    budget: story.loreBudget,
  });

  return { story, scene, history, droppedCount, loreHits: resolved.hits, transcriptTexts };
}

export function composeTurn(request: ChatRequest): TurnPayload | null {
  const overrides = request.overrides ?? {};
  const redoing =
    request.mode === 'regenerate' || request.mode === 'variant' ? request.messageId : undefined;

  const context = readTurnContext({
    storyId: request.storyId,
    sceneId: request.sceneId,
    messageId: redoing,
    immediate: [request.text ?? '', overrides.authorNote ?? ''].filter(Boolean),
  });
  if (!context) return null;

  const { story, scene, history, droppedCount, loreHits, transcriptTexts } = context;
  const calibration = readCalibration();
  const model = overrides.model ?? story.model;
  const effort = overrides.effort ?? story.effort;
  const temperature = overrides.temperature ?? story.temperature;
  const topP = overrides.topP ?? story.topP;
  const maxTokens = overrides.maxTokens ?? story.maxTokens;
  const targetWords = overrides.targetWords ?? story.targetWords;

  const immediate = [request.text ?? '', overrides.authorNote ?? ''].filter(Boolean);
  let recall: { memory: Memory; score: number }[] = [];
  if (overrides.recall !== false) {
    const query = [...immediate, ...transcriptTexts.slice(-2)].join('\n');
    const found = memories.recall(story.id, extractTerms(query), overrides.recallLimit ?? 6);
    // Drop weak matches: an irrelevant memory is pure input cost.
    const top = found[0]?.score ?? 0;
    recall = top > 0 ? found.filter((item) => item.score >= top * 0.35) : [];
  }

  /* Compose. */

  const composed = compose(
    buildComposerInput({
      story,
      scene,
      history,
      request,
      immediate,
      resolved: loreHits,
      recall,
      overrides,
      calibration,
      model,
      effort,
      maxTokens,
      targetWords,
    }),
    prefixes.latest(story.id),
  );

  composed.plan.previousHitRate = measuredHitRate(story.id);
  if (droppedCount > 0 && !story.synopsis.trim()) {
    composed.plan.warnings.push(
      `${droppedCount} older messages are outside the history budget and there is no synopsis, so the narrator has forgotten them. Run Summarise to fold them into the rolling synopsis.`,
    );
  }
  composed.plan.advice.push(...cacheAdvice(story.id, story, composed.plan));

  return {
    messages: composed.messages,
    plan: composed.plan,
    composed,
    model,
    effort,
    temperature,
    topP,
    maxTokens,
    targetWords,
  };
}

/**
 * Compose an agentic pass's payload: the story's shared head, plus the pass's brief.
 *
 * This is the second caller of `readTurnContext`, and the reason it exists. A pass
 * payload is a **prefix** of the story's narration payload — same preamble, same
 * world, same transcript window, byte for byte — with the pass's own brief where the
 * narration's volatile tail would be. So a Director call made right after a turn
 * pays hit prices for everything the narrator just cached, instead of a miss on a
 * private context of its own that nothing else will ever reuse.
 *
 * What it does *not* do: save a `prefixes` record. That record is the narration's
 * memory of its own last payload, and a pass overwriting it would make the next
 * turn diff against the wrong shape.
 */
export function composePass(input: {
  storyId: string;
  sceneId?: string | undefined;
  spec: PassSpec;
  model: ModelId;
  effort: ReasoningEffort;
  maxTokens: number;
}): Composed | null {
  const context = readTurnContext({ storyId: input.storyId, sceneId: input.sceneId });
  if (!context) return null;

  const { story, scene, history, loreHits } = context;
  return compose(
    {
      story,
      scene,
      characters: castOf(story),
      persona: resolvePersona(story),
      messages: history,
      loreHits,
      /* A pass recalls nothing and notes nothing: whatever it needs to know is in
         the head, and whatever it needs to do is in its own brief. */
      recall: [],
      threads: threads.list(story.id),
      directorBrief: '',
      authorNote: '',
      impersonateBrief: null,
      continueMode: false,
      resample: true,
      userTurn: '',
      calibration: readCalibration(),
      /* The plan is not what a pass is billed for — the ledger records the pass's
         real usage — so this only shapes the estimate it reports. */
      includeTools: false,
      model: input.model,
      effort: input.effort,
      maxTokens: input.maxTokens,
      targetWords: story.targetWords,
      prefill: '',
      pass: input.spec,
    },
    prefixes.latest(story.id),
  );
}

type ComposerArgs = {
  story: Story;
  scene: Scene;
  history: Message[];
  request: ChatRequest;
  immediate: string[];
  resolved: ComposerInput['loreHits'];
  recall: { memory: Memory; score: number }[];
  overrides: NonNullable<ChatRequest['overrides']>;
  calibration: Calibration;
  model: ModelId;
  effort: ReasoningEffort;
  maxTokens: number;
  targetWords: number;
};

function buildComposerInput(args: ComposerArgs): ComposerInput {
  const { story, request, overrides } = args;
  return {
    story,
    scene: args.scene,
    characters: castOf(story),
    persona: resolvePersona(story),
    messages: args.history,
    loreHits: args.resolved,
    recall: args.recall,
    threads: threads.list(story.id),
    directorBrief: buildDirectorBrief(story.id),
    authorNote: overrides.authorNote ?? '',
    impersonateBrief:
      request.mode === 'impersonate'
        ? [
            `Write the next turn as ${personaNameFor(story.id)} — the player character, not the narrator.`,
            request.brief?.trim() ?? '',
            'Write only their words and immediate physical action. One paragraph. No narration of the wider scene.',
          ]
            .filter(Boolean)
            .join('\n')
        : null,
    continueMode: request.mode === 'continue',
    /* A regenerate replays the same context rather than steering it: no per-turn
       cue, and no generated clause in the post-history instruction. */
    resample: request.mode === 'regenerate' || request.mode === 'variant',
    userTurn: turnInstruction(request),
    calibration: args.calibration,
    includeTools: overrides.includeTools ?? false,
    model: args.model,
    effort: args.effort,
    maxTokens: args.maxTokens,
    targetWords: args.targetWords,
    prefill: usesPrefill(request) ? (overrides.prefill ?? story.prefill) : '',
  };
}

/**
 * The final user message, for the verbs that have one.
 *
 * A **regenerate has none**, and that is the whole point: its context is the
 * transcript up to the turn it replaces, and the model generates the beat that
 * follows — exactly what the original call did, drawn again. The old wording
 * ("write the next beat again, differently") made it reason about a text it could
 * not see and paraphrase it; the follow-up, borrowing the continue sentence, still
 * told it what to do. Sampling is what makes a swipe different, and a chat request
 * whose transcript ends on the writer's turn needs no cue to answer it.
 *
 * `continue` does need one: its transcript ends on an assistant line, so there is
 * nothing to answer until it is asked to keep going.
 */
function turnInstruction(request: ChatRequest): string {
  if (request.mode === 'send') return (request.text ?? '').trim();
  if (request.mode === 'impersonate') {
    return request.brief?.trim()
      ? 'Write my next turn, following the brief.'
      : 'Write my next turn.';
  }
  if (request.mode === 'continue') return 'Continue the scene directly from where it stops.';
  /* `regenerate` and `variant` (which nothing sends yet) — no instruction. */
  return '';
}

/** Prefill rides only on fresh generations, where the shape is predictable. */
function usesPrefill(request: ChatRequest): boolean {
  return request.mode === 'send' || request.mode === 'continue' || request.mode === 'regenerate';
}

/** Dry run: reports the payload without spending anything. Drives the meter. */
export function planTurn(request: ChatRequest): PayloadPlan | null {
  return composeTurn(request)?.plan ?? null;
}

/* ------------------------------------------------------------------ turn */

export type TurnOptions = { emit: Emit; signal: AbortSignal };

export async function runTurn(request: ChatRequest, options: TurnOptions): Promise<void> {
  const { emit, signal } = options;
  const story = stories.get(request.storyId);
  if (!story) {
    emit({ type: 'error', message: 'Story not found.' });
    return;
  }
  const scene = request.sceneId
    ? (scenes.get(request.sceneId) ?? activeScene(story.id))
    : activeScene(story.id);
  if (!scene) {
    emit({ type: 'error', message: 'This story has no scenes. Create one first.' });
    return;
  }

  const text = (request.text ?? '').trim();
  if (request.mode === 'send' && !text) {
    emit({ type: 'error', message: 'Nothing to send.' });
    return;
  }

  // Compose *before* persisting, so the writer's turn arrives as the final user
  // message rather than being duplicated into the history block.
  const payload = composeTurn(request);
  if (!payload) {
    emit({ type: 'error', message: 'Could not assemble a prompt for this turn.' });
    return;
  }
  emit({ type: 'plan', plan: payload.plan });

  /* Persist the writer's turn now that composing has consumed it. */
  if (request.mode === 'send') {
    messages.create({
      storyId: story.id,
      sceneId: scene.id,
      role: 'user',
      variants: [text],
      origin: 'user',
    });
  }

  /* Resolve the message row this generation writes into. */

  let targetId: string;
  let variantIndex: number;
  let reasoningTraces: string[];

  if (request.mode === 'regenerate' || request.mode === 'variant') {
    const target = request.messageId ? messages.get(request.messageId) : undefined;
    if (!target) {
      emit({ type: 'error', message: 'Nothing to regenerate — the message no longer exists.' });
      return;
    }
    variantIndex = target.variants.length;
    reasoningTraces = [...target.reasoning];
    targetId = target.id;
  } else {
    const origin =
      request.mode === 'continue' ? 'continue' : request.mode === 'impersonate' ? 'impersonate' : 'narrator';
    const created = messages.create({
      storyId: story.id,
      sceneId: scene.id,
      role: request.mode === 'impersonate' ? 'user' : 'assistant',
      variants: [''],
      reasoning: [''],
      origin,
      // An impersonated turn is the *writer* speaking as the character, so it
      // stays unattributed and resolves to their persona like any other.
      speaker: request.mode === 'impersonate' ? null : narratorSpeaker(story),
      injections: payload.plan.loreHits,
    });
    targetId = created.id;
    variantIndex = 0;
    reasoningTraces = [''];
  }

  emit({ type: 'start', messageId: targetId, variantIndex });

  /* Stream, with an optional single inline tool round. */

  const tools: WireTool[] = (request.overrides?.includeTools ?? false) ? DIRECTOR_INLINE_TOOLS : [];
  const abortNote = () => signal.aborted;

  const result = await streamChat(
    {
      messages: payload.messages,
      model: payload.model,
      effort: payload.effort,
      temperature: payload.temperature,
      topP: payload.topP,
      maxTokens: payload.maxTokens,
      ...(tools.length > 0 ? { tools } : {}),
      prefixCompletion: payload.composed.usesPrefixCompletion,
      signal,
    },
    {
      onText: (delta) => emit({ type: 'text', delta }),
      onReasoning: (delta) => emit({ type: 'reasoning', delta }),
    },
  );

  let combinedText = result.text;
  let combinedReasoning = result.reasoning;
  let usage = {
    cacheHitTokens: result.usage.cacheHitTokens,
    cacheMissTokens: result.usage.cacheMissTokens,
    outputTokens: result.usage.outputTokens,
    reasoningTokens: result.usage.reasoningTokens,
    ttftMs: result.ttftMs,
    totalMs: result.totalMs,
  };

  const firstCall = result.toolCalls[0];
  if (tools.length > 0 && firstCall && !abortNote()) {
    const replay: WireMessage[] = [
      ...payload.messages,
      {
        role: 'assistant',
        content: result.text || null,
        // The API requires a full reasoning echo on any thread carrying tools.
        ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
        tool_calls: result.toolCalls,
      },
    ];

    for (const call of result.toolCalls) {
      const summary = applyInlineTool(
        story.id,
        scene.id,
        call.function.name,
        call.function.arguments,
      );
      emit({
        type: 'tool',
        name: call.function.name,
        args: call.function.arguments,
        ok: !summary.startsWith('error'),
        summary,
      });
    }
    replay.push({
      role: 'tool',
      tool_call_id: firstCall.id,
      content: 'done',
    });

    // The follow-up keeps tools on (required for the echo) but streams the prose.
    const followUp = await streamChat(
      {
        messages: replay,
        model: payload.model,
        effort: payload.effort,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
        tools,
        signal,
      },
      {
        onText: (delta) => emit({ type: 'text', delta }),
        onReasoning: (delta) => emit({ type: 'reasoning', delta }),
      },
    );

    combinedText += followUp.text;
    combinedReasoning += followUp.reasoning;
    usage = {
      cacheHitTokens: usage.cacheHitTokens + followUp.usage.cacheHitTokens,
      cacheMissTokens: usage.cacheMissTokens + followUp.usage.cacheMissTokens,
      outputTokens: usage.outputTokens + followUp.usage.outputTokens,
      reasoningTokens: usage.reasoningTokens + followUp.usage.reasoningTokens,
      ttftMs: usage.ttftMs ?? followUp.ttftMs,
      totalMs: usage.totalMs + followUp.totalMs,
    };
  }

  finalise({
    storyId: story.id,
    targetId,
    variantIndex,
    reasoningTraces,
    text: combinedText,
    reasoningText: combinedReasoning,
    usage,
    payload,
    emit,
  });

  /* The passes the writer switched on for this turn, once the turn is written.
     Not when it wrote nothing: there is no beat to react to, and billing somebody for
     three passes on top of a failed turn is the worst version of this feature. */
  if (combinedText.trim().length > 0) {
    await runRequestedPasses({
      story,
      scene,
      payload,
      targetId,
      overrides: request.overrides ?? {},
      emit,
      signal,
    });
  }
}

type FinaliseArgs = {
  storyId: string;
  targetId: string;
  variantIndex: number;
  reasoningTraces: string[];
  text: string;
  reasoningText: string;
  usage: {
    cacheHitTokens: number;
    cacheMissTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    ttftMs: number | null;
    totalMs: number;
  };
  payload: TurnPayload;
  emit: Emit;
};

function finalise(args: FinaliseArgs): void {
  const existing = messages.get(args.targetId);
  if (!existing) return;

  const isNewVariant = args.variantIndex >= existing.variants.length;
  const variants = [...existing.variants];
  if (isNewVariant) variants.push(args.text);
  else variants[args.variantIndex] = args.text;

  const reasoning = [...args.reasoningTraces];
  if (isNewVariant) reasoning.push(args.reasoningText);
  else reasoning[args.variantIndex] = args.reasoningText;

  /*
   * A generation that produced no prose at all. Say so, and leave no trace of it:
   * a brand-new message holds nothing but its empty placeholder, so the row goes; a
   * regenerate that failed keeps the turn it was replacing and gains no empty swipe.
   *
   * `existing.variants`, not `variants`: the placeholder case is the *first* variant
   * of a fresh message, where the appended-variant branch above never runs — which is
   * exactly the case this guard was written for.
   */
  if (args.text.trim().length === 0) {
    if (existing.variants.every((variant) => variant.trim().length === 0)) {
      messages.remove(args.targetId);
    }
    args.emit({ type: 'error', message: 'The model returned no text.' });
    return;
  }

  const peak = isPeak();
  const split = {
    cacheHitTokens: args.usage.cacheHitTokens,
    cacheMissTokens: args.usage.cacheMissTokens,
    outputTokens: args.usage.outputTokens,
  };
  const cost = costOf(args.payload.model, split, peak);
  const cold = coldCostOf(args.payload.model, split, peak);
  const saved = savedBy(args.payload.model, split, peak);

  const usageRecord = {
    model: args.payload.model,
    ...split,
    reasoningTokens: args.usage.reasoningTokens,
    ttftMs: args.usage.ttftMs,
    totalMs: args.usage.totalMs,
    costUsd: cost,
    savedUsd: saved,
    fingerprint: args.payload.plan.fingerprint,
    effort: args.payload.effort,
    peak,
  };

  /* The message, its cost event, and the prefix record are one fact about one
   * turn. Committing them separately would let a mid-sequence failure persist a
   * finished turn while losing the prefix record — which silently degrades the
   * next turn's cache prediction, with nothing on screen to show for it. */
  transaction(() => {
    messages.update(args.targetId, {
      variants,
      reasoning,
      activeVariant: isNewVariant ? variants.length - 1 : args.variantIndex,
      usage: usageRecord,
    });

    ledger.record({
      storyId: args.storyId,
      kind: 'narration',
      model: args.payload.model,
      ...split,
      reasoningTokens: args.usage.reasoningTokens,
      costUsd: cost,
      savedUsd: saved,
      peak,
    });

    // Record the payload shape so the next turn can diff against it.
    prefixes.save({
      fingerprint: args.payload.plan.fingerprint,
      storyId: args.storyId,
      tokens: args.payload.plan.totalTokens,
      blockHashes: Object.fromEntries(
        args.payload.composed.blocks.map((block) => [block.kind, block.hash]),
      ),
      blockTokens: Object.fromEntries(
        args.payload.composed.blocks.map((block) => [block.kind, block.tokens]),
      ),
      messageMeta: args.payload.messages.map((message) => {
        const content = message.content ?? '';
        return {
          hash: hashContent(message.role, content),
          tokens: estimateTokens(content) + 4,
          chars: content.length,
        };
      }),
    });
    prefixes.prune(args.storyId);
    stories.touch(args.storyId);
  });

  const reported = split.cacheHitTokens + split.cacheMissTokens;
  if (reported > 0) {
    learnCalibration(reported, estimateMessages(args.payload.messages, DEFAULT_CALIBRATION));
  }

  args.emit({ type: 'usage', usage: usageRecord });
  args.emit({ type: 'done', messageId: args.targetId });
}

/**
 * The side-channel passes the writer switched on for this turn, run **after** it.
 *
 * After, and not during, for three reasons that are really one: a pass reads the
 * story the turn just wrote, the turn's own payload unit is still warm (a pass that
 * shares the story's head is served from it rather than paying a private miss), and
 * the prose has already streamed — so a pass that fails costs the writer a receipt
 * and never their turn.
 *
 * A failure is reported, not thrown: the writer asked for a turn, and the pass was
 * an extra they opted into.
 */
async function runRequestedPasses(args: {
  story: Story;
  scene: Scene;
  payload: TurnPayload;
  targetId: string;
  overrides: NonNullable<ChatRequest['overrides']>;
  emit: Emit;
  signal: AbortSignal;
}): Promise<void> {
  const { story, scene, payload, overrides, emit, signal } = args;
  const wanted = [overrides.director, overrides.archivist, overrides.conductor].some(Boolean);
  if (!wanted) return;
  /* The writer pressed stop: they asked for the turn, not for three more calls. */
  if (signal.aborted) return;

  const report = (pass: string, label: string, ok: boolean, detail: string, costUsd: number) =>
    emit({ type: 'pass', pass, label, ok, detail, costUsd });

  const guard = async (
    pass: string,
    label: string,
    run: () => Promise<{ detail: string; costUsd: number; ok?: boolean }>,
  ) => {
    try {
      const { detail, costUsd, ok } = await run();
      report(pass, label, ok ?? true, detail, costUsd);
    } catch (error) {
      report(pass, label, false, error instanceof Error ? error.message : 'failed', 0);
    }
  };

  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

  if (overrides.director) {
    await guard('director', 'Director', async () => {
      /* Rides the turn's own story head: `composePass` renders everything in front of
         the brief exactly as the narrator did. */
      const passPayload = composePass({
        storyId: story.id,
        sceneId: scene.id,
        spec: directorMode(story.id),
        model: payload.model,
        effort: 'low',
        maxTokens: 900,
      });
      if (!passPayload) throw new Error('no payload to direct');
      const result = await runDirector(story.id, {
        messages: passPayload.messages,
        sceneId: scene.id,
        effort: 'low',
        signal,
      });
      if (!result) throw new Error('nothing to direct yet');
      return {
        detail: `${plural(result.notes.length, 'note', 'notes')}, ${plural(result.stateUpdates.length, 'state update', 'state updates')}`,
        costUsd: result.costUsd,
      };
    });
  }

  if (overrides.archivist) {
    await guard('archivist', 'Archivist', async () => {
      const result = await runArchivist(story.id, { signal });
      return { detail: plural(result.memories.length, 'memory', 'memories'), costUsd: result.costUsd };
    });
  }

  if (overrides.conductor) {
    await guard('conductor', 'Conductor', async () => {
      /* The turn's own bytes, not a re-composition: the conductor's whole trick is
         that its variants are byte-identical, and here the unit is already warm. */
      const result = await runConductor(
        story.id,
        {
          messages: payload.messages,
          model: payload.model,
          effort: payload.effort,
          topP: payload.topP,
          maxTokens: payload.maxTokens,
          ...(payload.composed.usesPrefixCompletion ? { prefixCompletion: true } : {}),
        },
        { variants: overrides.conductorVariants ?? 3, signal },
      );

      /* The candidates become swipes on the turn that was just written, and the
         judged one is what the writer sees. The text they watched arrive stays as
         variant 0 — one swipe back, and the judge never saw it to rank it. */
      const target = messages.get(args.targetId);
      if (target && result.candidates.length > 0) {
        messages.update(args.targetId, {
          variants: [...target.variants, ...result.candidates.map((candidate) => candidate.text)],
          reasoning: [...target.reasoning, ...result.candidates.map(() => '')],
          activeVariant: 1 + Math.max(0, Math.min(result.chosen, result.candidates.length - 1)),
        });
      }

      /* A pass that spent and produced nothing is a failure, not a result: the
         writer paid for it, and "0 alternatives, kept #1" would read as success. */
      if (result.candidates.length === 0) {
        return { detail: 'no candidate produced text', costUsd: result.costUsd, ok: false };
      }

      /* The judge's sentence is the useful part of the receipt, but it is a
         sentence — the fold and the toast both get a clipped copy. */
      const note =
        result.judgeNote.length > 140 ? `${result.judgeNote.slice(0, 139)}…` : result.judgeNote;
      return {
        detail: `${plural(result.candidates.length, 'alternative', 'alternatives')}, kept #${result.chosen + 1} — ${note}`,
        costUsd: result.costUsd,
      };
    });
  }
}

/* ---------------------------------------------------------------- helpers */

/**
 * Who a freshly written assistant turn belongs to.
 *
 * In an ensemble story the narrator is the narrator, and `speaker: null` renders
 * as such (the writer can re-attribute any turn). In a character chat the narrator
 * *is* the character — the payload holds exactly one card — so every turn wears
 * that card's name and portrait instead of a wall of unattributed prose.
 */
function narratorSpeaker(story: Story): string | null {
  return story.characterId ? (castOf(story)[0]?.name ?? null) : null;
}

/**
 * The Director's brief for the next narration, taken from the notes the writer
 * chose to keep. It lives in the volatile tail, so it can change every turn
 * without costing anything.
 */
function buildDirectorBrief(storyId: string): string {
  const kept = notes
    .list(storyId, 20)
    .filter((note) => note.accepted || note.kind === 'nudge')
    .slice(0, 3);
  if (kept.length === 0) return '';
  return kept.map((note) => `- ${note.body}`).join('\n');
}

/** Measured hit rate on the story's most recent narration, or null. */
function measuredHitRate(storyId: string): number | null {
  const recent = ledger.forStory(storyId, 12).find((event) => event.kind === 'narration');
  if (!recent) return null;
  return hitRate({
    cacheHitTokens: recent.cacheHitTokens,
    cacheMissTokens: recent.cacheMissTokens,
  });
}

/**
 * Turn the app's own measurements into concrete advice. This is where the cost
 * model talks back to the writer.
 */
function cacheAdvice(storyId: string, story: Story, plan: PayloadPlan): string[] {
  const advice: string[] = [];
  const events = ledger.forStory(storyId, 40).filter((event) => event.kind === 'narration');

  if (events.length >= 3) {
    const hit = events.reduce((sum, event) => sum + event.cacheHitTokens, 0);
    const miss = events.reduce((sum, event) => sum + event.cacheMissTokens, 0);
    const rate = hit + miss > 0 ? hit / (hit + miss) : 0;
    if (rate < 0.6) {
      advice.push(
        `Realised hit rate over the last ${events.length} narration calls is ${Math.round(rate * 100)}%. Below roughly 80%, a frozen block is usually being edited between turns — the inspector's "changed" flags name which one.`,
      );
    } else if (rate > 0.85) {
      advice.push(
        `Realised hit rate is ${Math.round(rate * 100)}% — this story is served almost entirely from cache, where an input token costs 1/${cacheMultiplier(story.model, isPeak()).toFixed(0)}th of a miss.`,
      );
    }
  }

  const brokenFrozen = plan.blocks.filter((block) => block.changed && block.volatility === 0);
  if (brokenFrozen.length > 0) {
    advice.push(
      `Frozen block${brokenFrozen.length > 1 ? 's' : ''} ${brokenFrozen.map((block) => `"${block.label}"`).join(', ')} changed this turn. They sit at the front of the payload, so editing them invalidates everything behind them.`,
    );
  }

  const warm = warmups.get(storyId);
  if (!warm || warm.fingerprint !== plan.fingerprint) {
    advice.push(
      'This exact payload shape is not warm yet. Warming costs one miss-priced pass with a tiny completion, and every later turn built on the same prefix becomes a hit.',
    );
  }

  return advice;
}
