import { hashContent } from '../shared/ids.ts';
import { estimateTokens, type Calibration } from '../shared/tokens.ts';
import { coldCostOf, costOf, isPeak, msUntilOffPeak } from '../shared/cost.ts';
import {
  BLOCK_LABELS,
  BLOCK_RANK,
  BLOCK_VOLATILITY,
  type BlockKind,
  type Character,
  type CostEstimate,
  type LoreHit,
  type Memory,
  type Message,
  type ModelId,
  type PayloadPlan,
  type Persona,
  type PromptBlockPreview,
  type ReasoningEffort,
  type Scene,
  type Story,
  type Thread,
} from '../shared/types.ts';
import type { MacroName } from '../shared/macros.ts';
import type { WireMessage } from './deepseek.ts';
import { groupByPosition, renderLore } from './lorebook.ts';
import { expandMacros, macroContextOf } from './macros.ts';
import { renderCast, renderState, renderThreads } from './render.ts';
import type { PrefixRecord } from './store/index.ts';

/**
 * The prompt composer.
 *
 * DeepSeek persists a cache prefix unit at every request boundary, and a hit
 * requires a **full** match against one of those units. Nothing is partial: if
 * byte 1 of the payload changes, the entire prefix misses. That single fact
 * drives the whole design here.
 *
 * The payload is therefore assembled as an ordered list of *blocks*, ordered by
 * `BLOCK_RANK` (frozen contract first, the turn's own words last), and rendered
 * into as few wire messages as possible:
 *
 *     [ system: contract ]          ← rebuilt only when the story's contract changes
 *     [ system: cast + anchored lore ]
 *     [ user:   transcript tail ]   ← ALL history in ONE message
 *     [ system: depth lore, state, director brief, recalled memories, author note ]
 *     [ user:   the writer's turn ]
 *
 * Two consequences are worth spelling out:
 *
 * - **History is one message, not one message per turn.** DeepSeek's cache unit
 *   is the request boundary, so a hit needs an exact payload prefix. Rendering
 *   the transcript as `system, user, assistant, user, assistant, …` means the
 *   prefix only matches up to the previous turn's *end* — which it would anyway.
 *   Collapsing it into a single user message is what lets the *fixed* region
 *   (`system` blocks) match across an arbitrarily long conversation, and it
 *   removes per-message framing overhead from the bill.
 *
 * - **Volatile content sits last.** Because a change invalidates only that block
 *   and everything after it, putting the scene state, director brief, recalled
 *   memories and author note at the very end means they can churn every turn
 *   without touching the expensive prefix in front of them.
 */

/** Identity used to keep the `[user]` transcript block stable while it grows. */
export type ComposerInput = {
  story: Story;
  scene: Scene;
  characters: Character[];
  persona: Persona | null;
  messages: Message[];
  loreHits: LoreHit[];
  recall: { memory: Memory; score: number }[];
  threads: Thread[];
  /** Latest accepted director notes, appended as a side-channel brief. */
  directorBrief: string;
  /** Turns the stylist's mid-conversation instruction. */
  authorNote: string;
  /** Set for `impersonate` — instructs the model to write as the user. */
  impersonateBrief: string | null;
  /** Set for `continue` — asks for an uninterrupted continuation. */
  continueMode: boolean;
  /**
   * Set for `regenerate` — the context is replayed, not steered. No generated clause
   * is added to the post-history instruction and no per-turn cue is appended, so the
   * model generates from exactly the transcript the original call saw.
   */
  resample: boolean;
  /** The writer's newest turn, appended verbatim. Empty for a regenerate. */
  userTurn: string;
  calibration: Calibration;
  includeTools: boolean;
  /** Optional per-turn overrides. */
  model: ModelId;
  effort: ReasoningEffort;
  maxTokens: number;
  targetWords: number;
  prefill: string;
  /**
   * Set when this payload is for an agentic pass rather than the narrator.
   *
   * Everything in front of the tail — the whole frozen region and the transcript —
   * is then built exactly as the narration payload builds it, so a pass shares the
   * story's cache unit instead of paying for a private prefix of its own. The pass
   * supplies its own tail; the narration's (recalled memories, scene state, kept
   * director notes, author note, post-history instruction) would all be wrong for
   * it, since none of them address the pass's job.
   */
  pass?: PassSpec;
};

/**
 * What a pass is told, and the only thing a pass payload adds to the story's head.
 *
 * Kept deliberately small: `tail` is the pass's role and brief, rendered as the
 * `mode` block, and `turn` is the pass's actual task as the final user message —
 * the same position the writer's turn occupies in a narration payload.
 */
export type PassSpec = {
  /** Stable id, used in the log line and by `composePass` callers. */
  id: string;
  /** The pass's role and brief. Replaces the narration tail entirely. */
  tail: string;
  /** The pass's task, appended as the last user message. */
  turn?: string;
};


export type Composed = {
  messages: WireMessage[];
  plan: PayloadPlan;
  /** Rendered blocks, kept for the inspector and for the prefix record. */
  blocks: { kind: BlockKind; text: string; hash: string; tokens: number; macros: MacroName[] }[];
  /** True when a trailing assistant prefill must be sent with `prefix: true`. */
  usesPrefixCompletion: boolean;
};

const HEADINGS: Partial<Record<BlockKind, string>> = {
  contract: 'Voice & format contract',
  genre: 'Genre & tone',
  style: 'Prose style',
  story: 'Story bible',
  scenario: 'Scenario',
  cast: 'Cast',
  persona: 'Player character',
  'lore-anchor': 'Established world facts',
  history: 'Transcript so far',
  'lore-at-depth': 'Relevant lore',
  state: 'Current scene state',
  director: 'Story direction notes',
  retrieval: 'Relevant remembered details',
  'lore-before': 'Context for this moment',
  'author-note': 'Author note',
  'lore-after': 'Just revealed',
  exemplars: 'Style exemplars',
  impersonate: 'Impersonation brief',
  instruct: 'Instruction',
  mode: 'This call',
};

function truncate(text: string, limit = 240): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

/**
 * Build every block, then sort by volatility class. Blocks render exactly as the
 * model sees them — the inspector shows these strings and nothing more.
 *
 * Macros are expanded here, in the one place a block becomes text, so the hash,
 * the token count and the inspector all see the resolved string. The transcript
 * is the exception: it is a record of what was said, not a template, and
 * re-resolving it against live state would rewrite the cached prefix every time a
 * persona or a card changed. The writer's own turn is exempt for the same reason —
 * expanding it on the turn it is typed but not once it is history would make the
 * tail of the transcript block differ from what was sent, which is a miss on every
 * turn rather than a feature.
 */
export function compose(input: ComposerInput, previous: PrefixRecord | null): Composed {
  const { story, scene, calibration } = input;
  const blocks: { kind: BlockKind; text: string; hash: string; tokens: number; macros: MacroName[] }[] = [];
  const macroContext = macroContextOf(story, scene, input.threads);

  const push = (kind: BlockKind, body: string) => {
    const resolved = kind === 'history' ? { text: body, macros: [] as MacroName[] } : expandMacros(body, macroContext);
    const text = resolved.text.trim();
    if (!text) return;
    const heading = HEADINGS[kind];
    const rendered = heading ? `## ${heading}\n${text}` : text;
    blocks.push({
      kind,
      text: rendered,
      hash: hashContent(kind, rendered),
      tokens: estimateTokens(rendered, calibration),
      macros: resolved.macros,
    });
  };

  /* ---- frozen region: changes only when the writer edits these fields ---- */

  push('contract', story.contract);
  push('genre', story.genre);
  push('style', story.style);
  push('story', story.bible);
  push('scenario', story.scenario);
  push('exemplars', story.exemplars);

  const cast = renderCast(input.characters);
  const grouped = groupByPosition(input.loreHits);
  push('cast', cast);
  push('persona', input.persona?.description ?? '');
  push('lore-anchor', renderLore(grouped.anchor, 'Established world facts:'));

  /* ---- the transcript, rendered as ONE message ---- */

  const historyParts: string[] = [];
  if (story.synopsis.trim()) {
    historyParts.push(`Previously: ${story.synopsis.trim()}`);
  }
  for (const message of input.messages) {
    if (message.disabled) continue;
    const body = message.variants[message.activeVariant] ?? '';
    if (!body.trim()) continue;
    const speaker =
      message.role === 'user'
        ? (input.persona?.name ?? 'Player')
        : message.speaker ?? 'Narrator';
    historyParts.push(`${speaker}: ${body.trim()}`);
  }
  push('history', historyParts.join('\n\n'));

  /* ---- volatile region: everything below may churn every single turn ---- */

  /*
   * A pass replaces this whole region with its own brief. Not because the pass
   * could not use scene state or the writer's author note, but because every one of
   * these blocks is addressed to the *narrator* — `instruct` in particular says
   * "write the next beat" — and a pass is told what to do by its own tail. Keeping
   * the narration tail and appending a pass brief after it would also move the
   * divergence point to wherever the first of these blocks landed, which on a story
   * with a director brief and recalled memories is several hundred tokens of the
   * prefix the pass exists to share.
   */
  const pass = input.pass;

  if (!pass) {
    const turnCue = input.resample
      ? ''
      : input.continueMode
        ? `Continue the scene directly from where the transcript stops. Do not restate anything already written. ${input.targetWords} words.`
        : `Write the next beat. Target ${input.targetWords} words.`;
    const instruct = [story.instruct, turnCue].filter(Boolean).join('\n\n');

    push('retrieval', input.recall.length
      ? input.recall.map((item) => `- ${item.memory.text}`).join('\n')
      : '');

    push('state', renderState(scene));
    push('director', [input.directorBrief, renderThreads(input.threads)].filter(Boolean).join('\n\n'));
    push('lore-before', renderLore(grouped.before, 'Context for this moment:'));
    push('lore-after', renderLore(grouped.after, 'Just revealed:'));
    push('impersonate', input.impersonateBrief ?? '');

    /*
     * The post-history instruction block: the writer's own directive, plus a cue from
     * the verb. A regenerate gets no cue — the transcript already ends on the turn it
     * is answering, and adding "write the next beat" would be an instruction the
     * original call did not have. The writer's own `story.instruct` is part of the
     * context and stays for every verb.
     */
    push('instruct', instruct);

    push('author-note', input.authorNote);
  } else {
    push('mode', pass.tail);
  }

  /*
   * Depth-mounted lore.
   *
   * Classic lorebooks splice these *inside* the transcript at a configured depth
   * from the end. That is incompatible with the cache strategy here: the
   * transcript is one collapsed message precisely so its prefix survives growth,
   * and inserting a system turn into the middle of it would rewrite the block on
   * every change of depth.
   *
   * So depth lore is injected immediately after the transcript — the deepest
   * point that does not fragment the cached history — and `depth` orders the
   * entries within that slot (shallowest first, so the most immediate facts sit
   * closest to the model's next token). Same authoring intent, cacheable shape.
   *
   * A pass never gets it. Depth lore is selected for the beat the *narrator* is
   * about to write, from the writer's in-flight turn; a pass has no such turn, and
   * the block sits in front of the pass's own brief.
   */
  const depthHits = pass
    ? []
    : input.loreHits
        .filter((hit) => hit.position === 'depth')
        .sort((a, b) => b.depth - a.depth);
  /* Depth lore rides outside the block list, so its macros are resolved here
     rather than in `push` — the writer should not have to remember which lore
     position a `{{char}}` works in. It sits in the volatile tail, so nothing
     frozen depends on the result. */
  const depthLore = expandMacros(renderLore(depthHits, ''), macroContext).text;

  /* ---- order and render ---- */

  blocks.sort((a, b) => BLOCK_RANK[a.kind] - BLOCK_RANK[b.kind]);

  const messages: WireMessage[] = [];
  const preamble = blocks.filter((block) =>
    ['contract', 'genre', 'style', 'story', 'scenario', 'exemplars'].includes(block.kind),
  );
  if (preamble.length > 0) {
    messages.push({ role: 'system', content: preamble.map((block) => block.text).join('\n\n') });
  }

  const world = blocks.filter((block) =>
    ['cast', 'persona', 'lore-anchor'].includes(block.kind),
  );
  if (world.length === 0) {
    // Nothing to say yet; still send a system message so the payload shape is
    // stable from the first turn onward.
    messages.push({ role: 'system', content: 'The cast has not been introduced yet.' });
  } else {
    messages.push({ role: 'system', content: world.map((block) => block.text).join('\n\n') });
  }

  const history = blocks.find((block) => block.kind === 'history');
  if (history) messages.push({ role: 'user', content: history.text });
  if (depthHits.length > 0) {
    messages.push({ role: 'system', content: depthLore });
  }

  const tail = blocks.filter((block) =>
    [
      'retrieval',
      'state',
      'director',
      'lore-before',
      'lore-after',
      'author-note',
      'instruct',
      'impersonate',
      'mode',
    ].includes(block.kind),
  );
  if (tail.length > 0) {
    messages.push({ role: 'system', content: tail.map((block) => block.text).join('\n\n') });
  }

  /* The per-turn cue. A regenerate has none: the payload ends on the context the
     original call sent — the volatile tail, or the transcript itself when the tail
     is empty — and the model generates the beat that follows. A pass has its own
     task instead, in the same position. */
  const turn = pass ? (pass.turn ?? '') : input.userTurn;
  if (turn.trim()) messages.push({ role: 'user', content: turn });

  /* ---- Chat Prefix Completion ---- */

  let usesPrefixCompletion = false;
  const prefill = pass ? '' : expandMacros(input.prefill, macroContext).text;
  if (prefill.trim()) {
    messages.push({ role: 'assistant', content: prefill, prefix: true });
    usesPrefixCompletion = true;
  }

  /* ---- accounting ---- */

  const messageMeta = messages.map((message) => {
    const content = message.content ?? '';
    return {
      hash: hashContent(message.role, content),
      tokens: estimateTokens(content, calibration) + 4,
      // Kept so the next turn can re-hash a leading slice and prove the old
      // content is still an intact prefix without storing the text itself.
      chars: content.length,
    };
  });

  const totalTokens = messageMeta.reduce((sum, meta) => sum + meta.tokens, 0);

  /*
   * Walk the previous payload and this one in lockstep to find the shared prefix.
   *
   * The subtlety is the transcript block: it *grows* every turn, so its content
   * hash always differs — yet the text already written never moves, and DeepSeek
   * matches at the token level. So when a message's hash changes but its content
   * has simply been extended, the old content is still a live prefix and its
   * tokens are still cached.
   *
   * That is detected without storing any transcript text: a stored content hash
   * plus its character length is enough to re-hash the leading slice of the new
   * content and confirm it is the old content verbatim. Exact, and the stored
   * record stays a few bytes per message.
   *
   * The match stops at the first genuine divergence, because every message after
   * it has shifted position.
   */
  let stablePrefixTokens = 0;
  if (previous) {
    const limit = Math.min(previous.messageMeta.length, messageMeta.length);
    for (let index = 0; index < limit; index += 1) {
      const prior = previous.messageMeta[index];
      const current = messageMeta[index];
      if (!prior || !current) break;

      if (prior.hash === current.hash) {
        stablePrefixTokens += current.tokens;
        continue;
      }

      // Diverged. If the new message merely extends the old one, the old content
      // is a prefix of it and survives in the cache. A record written before
      // `chars` existed has `chars === 0`, which simply skips this check — the
      // estimate under-reports for one turn and then self-corrects, since the
      // record is rewritten with the field on every request.
      const content = messages[index]?.content ?? '';
      if (prior.chars > 0 && content.length > prior.chars) {
        const leading = content.slice(0, prior.chars);
        if (hashContent(String(messages[index]?.role ?? ''), leading) === prior.hash) {
          stablePrefixTokens += prior.tokens;
        }
      }
      break;
    }
  }

  const peak = isPeak();
  const outputTokens = Math.round(input.targetWords * 1.6) + 64;
  const split = {
    cacheHitTokens: Math.round(stablePrefixTokens),
    cacheMissTokens: Math.max(0, Math.round(totalTokens - stablePrefixTokens)),
    outputTokens,
  };
  const estimate: CostEstimate = {
    exact: false,
    ...split,
    costUsd: costOf(input.model, split, peak),
    coldCostUsd: coldCostOf(input.model, split, peak),
    savedUsd: coldCostOf(input.model, split, peak) - costOf(input.model, split, peak),
    peak,
    model: input.model,
  };

  const blockPreviews: PromptBlockPreview[] = blocks.map((block) => ({
    kind: block.kind,
    label: BLOCK_LABELS[block.kind],
    tokens: block.tokens,
    volatility: BLOCK_VOLATILITY[block.kind],
    hash: block.hash,
    changed: previous ? previous.blockHashes[block.kind] !== block.hash : true,
    stablePrefixTokens,
    macros: block.macros,
    preview: truncate(block.text, 400),
  }));

  const predictedHitRate = totalTokens > 0 ? stablePrefixTokens / totalTokens : 0;

  const plan: PayloadPlan = {
    storyId: story.id,
    fingerprint: hashContent(...messages.map((message) => `${message.role}:${message.content ?? ''}`)),
    blocks: blockPreviews,
    messages: messages.length,
    totalTokens,
    stablePrefixTokens,
    estimate,
    predictedHitRate,
    previousHitRate: null,
    loreHits: input.loreHits,
    retrieval: input.recall.map((item) => ({
      memoryId: item.memory.id,
      text: item.memory.text,
      score: item.score,
    })),
    includeTools: input.includeTools,
    effort: input.effort,
    warnings: buildWarnings(input, blocks, totalTokens),
    advice: buildAdvice(input, blocks, predictedHitRate, previous),
  };

  return { messages, plan, blocks, usesPrefixCompletion };
}

function buildWarnings(
  input: ComposerInput,
  blocks: readonly { kind: BlockKind; tokens: number; text: string; macros: MacroName[] }[],
  totalTokens: number,
): string[] {
  const warnings: string[] = [];

  const largest = [...blocks].sort((a, b) => b.tokens - a.tokens)[0];
  if (largest && totalTokens > 0 && largest.tokens / totalTokens > 0.6) {
    warnings.push(
      `"${BLOCK_LABELS[largest.kind]}" is ${Math.round((largest.tokens / totalTokens) * 100)}% of the payload.`,
    );
  }

  /* A macro in a frozen block is a real cache decision: the block is re-rendered
     from live story state every turn, so the thing the macro reads becomes part of
     the prefix's stability. Said here, where the plan is read, rather than left to
     be discovered in the ledger. */
  for (const block of blocks) {
    if (block.macros.length === 0 || BLOCK_VOLATILITY[block.kind] !== 0) continue;
    const names = block.macros.map((name) => `{{${name}}}`).join(', ');
    warnings.push(
      `"${BLOCK_LABELS[block.kind]}" expands ${names}, so that value sits in the frozen prefix: change it — a persona switch, an edited card — and this block and everything behind it re-pay at the miss price.`,
    );
  }

  if (input.recall.length > 0 && input.messages.length < 6) {
    warnings.push('Memory recall is firing very early in the story, where it adds little.');
  }

  if (input.directorBrief.length > 1200) {
    warnings.push('The director brief is long; it sits in the volatile tail on every turn.');
  }

  if (totalTokens > 120_000) {
    warnings.push('Payload is over 120k tokens — check the history budget for this story.');
  }

  if (input.model === 'deepseek-v4-pro' && isPeak()) {
    warnings.push('V4 Pro during peak hours costs 3.3× the flash rate. Consider waiting or switching.');
  }

  return warnings;
}

function buildAdvice(
  input: ComposerInput,
  blocks: readonly { kind: BlockKind; tokens: number }[],
  predictedHitRate: number,
  previous: PrefixRecord | null,
): string[] {
  const advice: string[] = [];
  const peak = isPeak();

  if (peak) {
    advice.push(
      `Peak window is billing at 2× right now — off-peak resumes in ${Math.round(
        msUntilOffPeak() / 60_000,
      )}m. Deferring a long session halves the bill.`,
    );
  }

  if (input.recall.length > 0) {
    const spend = blocks.find((block) => block.kind === 'retrieval')?.tokens ?? 0;
    advice.push(
      `Recall injected ${input.recall.length} memories (${spend} tok). Recall runs locally via BM25 and costs nothing to compute, but this block is in the volatile tail — every turn pays miss price for it.`,
    );
  }

  if (predictedHitRate < 0.4 && input.messages.length > 4) {
    advice.push(
      `Only ${Math.round(predictedHitRate * 100)}% of this payload matches the previous turn. Usually that means an early block changed — check the inspector for the first block flagged "changed".`,
    );
  }

  if (input.authorNote.trim()) {
    advice.push('The author note changes the payload tail on every turn; it is already positioned last, so it only invalidates itself.');
  }

  if (previous && previous.tokens > 0) {
    advice.push(
      `Previous request was ${previous.tokens} tok. Keeping the cast and story bible untouched preserves a ${previous.tokens}-token cached prefix.`,
    );
  }

  advice.push(
    'Run the warm-up after editing the story bible or cast: it costs one miss-priced pass and converts every following turn into a hit.',
  );

  return advice;
}

/** Groups resolved lore hits by injection position for the inspector. */
