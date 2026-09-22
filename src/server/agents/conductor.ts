/**
 * The Conductor — n-variant sampling with a cheap judge.
 *
 * Separate because it is the one pass that is a cost play rather than a text
 * transform: the variants send byte-identical payloads so every one after the
 * first is served from disk cache, and the pre-run estimate the UI shows has to be
 * derived from that same constraint.
 */

import { costOf, isPeak } from '../../shared/cost.ts';
import type { ModelId, ReasoningEffort } from '../../shared/types.ts';
import type { ConductorResult } from '../../shared/api.ts';
import { completeJson, streamChat, type WireMessage } from '../deepseek.ts';
import { messages } from '../store/index.ts';
import {
  activeScene,
  buildTranscriptView,
  personaNameFor,
  recordSideCall,
  renderTranscript,
  requireStory,
} from './context.ts';

const JUDGE_SYSTEM = `You are choosing between candidate continuations of a collaborative story.

You are given the scene so far and several candidates. Pick the one the author should read.

Weigh, in order:
1. Voice — does it match the established register and the characters' speech? Candidates that break voice are out, regardless of their ideas.
2. Momentum — does it move the scene somewhere, rather than restating or treading water?
3. Restraint — does it respect what the player character is allowed to decide? Candidates that narrate the player's choices or feelings are penalised heavily.
4. Specificity — concrete detail over general atmosphere.

Tie-break toward the candidate with the strongest final sentence.

Respond with JSON only: {"chosen": 0, "rationale": "one sentence naming the decisive reason"}`;

/**
 * The cost play.
 *
 * Every variant sends a **byte-identical payload**. The first request persists a
 * cache unit at its own request boundary; each later variant is then served that
 * entire prefix from disk cache at 1/50th the price. Three drafts therefore cost
 * roughly `1 × miss + 2 × hit` of input instead of `3 × miss`, and output tokens
 * — the only genuinely unavoidable cost — dominate the bill.
 *
 * Two consequences:
 * - Variants run **sequentially**, not in parallel. A cache unit only becomes
 *   servable once the first request has persisted it, so racing them would make
 *   all of them pay the miss price. The second call is also the faster one.
 * - `messages` must not vary per variant. Only sampling parameters may.
 */
export async function runConductor(
  storyId: string,
  request: {
    messages: WireMessage[];
    model: ModelId;
    effort: ReasoningEffort;
    topP: number;
    maxTokens: number;
  },
  options: {
    variants?: number;
    judgeModel?: ModelId;
    signal?: AbortSignal;
    /** Sampling temperatures, one per variant. Cycled if fewer than `variants`. */
    temperatures?: number[];
  } = {},
): Promise<ConductorResult> {
  const count = Math.min(6, Math.max(2, options.variants ?? 3));
  const judgeModel = options.judgeModel ?? 'deepseek-flash';
  const temperatures = options.temperatures?.length ? options.temperatures : [0.85, 1.0, 1.15, 0.7];

  const drafts: string[] = [];
  let costUsd = 0;

  for (let index = 0; index < count; index += 1) {
    const result = await streamChat(
      {
        messages: request.messages,
        model: request.model,
        effort: request.effort,
        temperature: temperatures[index % temperatures.length] ?? 1,
        topP: request.topP,
        maxTokens: request.maxTokens,
        signal: options.signal,
      },
      {},
    );
    costUsd += recordSideCall('conductor', storyId, request.model, result);
    const text = result.text.trim();
    if (text) drafts.push(text);
  }

  if (drafts.length === 0) {
    return { kind: 'conductor', candidates: [], chosen: 0, judgeNote: 'No candidate produced text.', costUsd };
  }

  const verdict = await judgeVariants(storyId, drafts, { judgeModel, signal: options.signal });

  return {
    kind: 'conductor',
    candidates: drafts.map((text, index) => ({ index, text, rationale: '' })),
    chosen: verdict.chosen,
    judgeNote: verdict.rationale,
    costUsd: costUsd + verdict.costUsd,
  };
}

/** Standalone judge: picks the best of several candidates. */
export async function judgeVariants(
  storyId: string,
  candidates: string[],
  options: { judgeModel?: ModelId; signal?: AbortSignal } = {},
): Promise<{ chosen: number; rationale: string; costUsd: number }> {
  const usable = candidates.map((text) => text.trim()).filter(Boolean);
  if (usable.length < 2) return { chosen: 0, rationale: 'Need at least two candidates.', costUsd: 0 };

  const story = requireStory(storyId);
  const scene = activeScene(storyId);
  const view = buildTranscriptView(messages.list(storyId, scene?.id), personaNameFor(storyId), 8);
  const judgeModel = options.judgeModel ?? 'deepseek-flash';

  const { value, result } = await completeJson<{ chosen?: unknown; rationale?: unknown }>({
    model: judgeModel,
    effort: 'none',
    maxTokens: 300,
    temperature: 0.2,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      {
        role: 'user',
        content: [
          `Story: ${story.title}`,
          story.style ? `Style directive:\n${story.style}` : '',
          `\nScene so far:\n${renderTranscript(view)}`,
          ...usable.map((text, index) => `\n--- Candidate ${index} ---\n${text}`),
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    signal: options.signal,
  });

  const costUsd = recordSideCall('judge', storyId, judgeModel, result);
  const picked = typeof value?.chosen === 'number' ? Math.trunc(value.chosen) : 0;
  return {
    chosen: picked >= 0 && picked < usable.length ? picked : 0,
    rationale: typeof value?.rationale === 'string' ? value.rationale.trim() : '',
    costUsd,
  };
}

/**
 * Cost of a conductor run before it is made, for the UI's confirmation prompt.
 *
 * The variants send **byte-identical payloads**, which is the whole trick: the
 * first request persists a cache unit at its own request boundary, so every
 * later variant is served that entire prefix from disk cache. Input cost is
 * therefore one full miss plus `variants - 1` full hits, not `variants` misses.
 */
export function estimateConductorCost(
  totalTokens: number,
  outputTokens: number,
  variants: number,
  peak = isPeak(),
): number {
  const count = Math.min(6, Math.max(2, variants));
  const split = {
    cacheMissTokens: totalTokens,
    cacheHitTokens: totalTokens * (count - 1),
    outputTokens: outputTokens * count + 300,
  };
  return costOf('deepseek-flash', split, peak);
}
