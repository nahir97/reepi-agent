/**
 * Shared context for every agentic pass.
 *
 * Each pass starts from the same few things: the story row, a bounded transcript
 * view, and the scene and persona lookups that decide which slice of it to read.
 * They live together because two copies of a prompt-shaping helper drift, and a
 * drift in what the model is shown is a behaviour change rather than a refactor.
 *
 * `recordSideCall` belongs here for the same reason: every pass must route its
 * real usage through it, so the ledger can separate agentic spend from narration
 * spend.
 */

import { costOf, coldCostOf, isPeak } from '../../shared/cost.ts';
import type {
  CostEventKind,
  Message,
  ModelId,
  ReasoningEffort,
  Story,
} from '../../shared/types.ts';
import type { ChatResult } from '../deepseek.ts';
import { ledger, personas, scenes, stories } from '../store/index.ts';

export const SIDE_EFFORT: ReasoningEffort = 'none';

/** Records a side-channel call's true usage and returns its cost. */
export function recordSideCall(
  kind: CostEventKind,
  storyId: string | null,
  model: ModelId,
  result: ChatResult,
): number {
  const split = {
    cacheHitTokens: result.usage.cacheHitTokens,
    cacheMissTokens: result.usage.cacheMissTokens,
    outputTokens: result.usage.outputTokens,
  };
  const peak = isPeak();
  const cost = costOf(model, split, peak);
  const cold = coldCostOf(model, split, peak);

  ledger.record({
    storyId,
    kind,
    model,
    cacheHitTokens: split.cacheHitTokens,
    cacheMissTokens: split.cacheMissTokens,
    outputTokens: split.outputTokens,
    reasoningTokens: result.usage.reasoningTokens,
    costUsd: cost,
    savedUsd: Math.max(0, cold - cost),
    peak,
  });

  return cost;
}

/** Compact transcript view shared by every agent prompt. */
export type TranscriptView = { role: 'user' | 'assistant'; speaker: string; text: string }[];

export type AgentContext = {
  story: Story;
  transcript: TranscriptView;
  /** Current scene facts, so the Director can refine rather than restate them. */
  state: { key: string; value: string }[];
  openThreads: string[];
  /** Existing memory texts, so the Archivist can avoid duplicates. */
  existingMemories: string[];
};

export function buildTranscriptView(
  messageList: readonly Message[],
  personaName: string,
  limit = 24,
): TranscriptView {
  const usable = messageList.filter((message) => !message.disabled).slice(-limit);
  return usable.map((message) => ({
    role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
    speaker:
      message.role === 'user' ? personaName : (message.speaker ?? 'Narrator'),
    text: (message.variants[message.activeVariant] ?? '').trim(),
  }));
}

export function renderTranscript(view: TranscriptView): string {
  return view
    .filter((line) => line.text)
    .map((line) => `${line.speaker}: ${line.text}`)
    .join('\n\n');
}

export function requireStory(storyId: string): Story {
  const story = stories.get(storyId);
  if (!story) throw new Error(`Story ${storyId} not found`);
  return story;
}

export function storiesSafe(storyId: string): Story | null {
  return stories.get(storyId);
}

export function activeScene(storyId: string) {
  const list = scenes.list(storyId);
  return list.length > 0 ? (list[list.length - 1] ?? null) : null;
}

export function personaNameFor(storyId: string): string {
  const story = stories.get(storyId);
  if (!story) return 'Player';
  const list = personas.list(storyId);
  const chosen = story.personaId ? list.find((persona) => persona.id === story.personaId) : undefined;
  return chosen?.name ?? list[0]?.name ?? 'Player';
}
