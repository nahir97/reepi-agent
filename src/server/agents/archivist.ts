/**
 * The Archivist pass — long-term memory extraction.
 *
 * It mines a transcript slice for durable facts and de-duplicates them against the
 * existing memory index before inserting. Separate from the Director because it is
 * a JSON-only pass with no tool loop and its own dedupe rule.
 */

import type { Memory, ModelId } from '../../shared/types.ts';
import type { ArchivistResult } from '../../shared/api.ts';
import { completeJson } from '../deepseek.ts';
import { memories, messages } from '../store/index.ts';
import {
  activeScene,
  buildTranscriptView,
  personaNameFor,
  recordSideCall,
  renderTranscript,
  requireStory,
} from './context.ts';

export const ARCHIVIST_SYSTEM = `You are an archivist maintaining a long-term memory index for an ongoing story.

You read recent transcript and extract only durable facts that will still matter hundreds of turns later. You return JSON.

Extract:
- facts: hard world or plot facts ("the ledger went missing on a Tuesday").
- relationship: how two characters now stand with each other, including shifts.
- promise: commitments, threats, and debts that must be honoured later.
- trait: a specific, demonstrated character trait ("Mira lies by understatement").
- place: a location and its defining detail.

Rules:
- Each entry is ONE standalone sentence, understandable with no surrounding context. Name the people involved explicitly rather than using pronouns.
- Do NOT extract transient action, weather, mood, or anything a reader would forget in a paragraph.
- Do NOT extract anything already present in the existing memories list.
- Salience 0..1: 0.9+ for oaths, deaths, reveals and identity; 0.5 for ordinary relationship beats; 0.2 for background texture.
- Most excerpts contain nothing worth keeping. Returning an empty array is the correct and expected answer most of the time. Return at most six entries.

Respond with JSON only:
{"memories":[{"text":"...","subject":"...","kind":"fact|relationship|promise|trait|place","salience":0.0}]}`;

export async function runArchivist(
  storyId: string,
  options: { model?: ModelId; sinceSeq?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<ArchivistResult> {
  const story = requireStory(storyId);
  const scene = activeScene(storyId);
  const all = messages.list(storyId, scene?.id);
  const slice =
    options.sinceSeq !== undefined
      ? all.filter((_message, index) => index > options.sinceSeq!)
      : all.slice(-(options.limit ?? 20));

  const view = buildTranscriptView(slice, personaNameFor(storyId), slice.length);
  if (view.length === 0) return { memories: [], costUsd: 0 };

  const existing = memories.list(storyId, 200).map((memory) => `- ${memory.text}`);
  const model = options.model ?? 'deepseek-flash';

  const { value, result } = await completeJson<{
    memories?: { text?: unknown; subject?: unknown; kind?: unknown; salience?: unknown }[];
  }>({
    model,
    effort: 'none',
    maxTokens: 1200,
    messages: [
      { role: 'system', content: ARCHIVIST_SYSTEM },
      {
        role: 'user',
        content: [
          `Story: ${story.title}`,
          `\nExisting memories (do not duplicate):\n${existing.join('\n') || '(none)'}`,
          `\nTranscript to mine:\n${renderTranscript(view)}`,
        ].join('\n'),
      },
    ],
    signal: options.signal,
  });

  const costUsd = recordSideCall('archivist', storyId, model, result);
  const rows = Array.isArray(value?.memories) ? value!.memories! : [];

  const maxSeq = all.length > 0 ? all.length - 1 : 0;
  const inserted: Pick<Memory, 'text' | 'subject' | 'kind' | 'salience'>[] = [];
  const normalised = new Set(existing.map(normaliseForCompare));

  for (const row of rows.slice(0, 8)) {
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (text.length < 12) continue;
    const key = normaliseForCompare(`- ${text}`);
    if (normalised.has(key)) continue;
    normalised.add(key);

    const kindRaw = typeof row.kind === 'string' ? row.kind : 'fact';
    const kind: Memory['kind'] =
      kindRaw === 'relationship' || kindRaw === 'promise' || kindRaw === 'trait' || kindRaw === 'place'
        ? kindRaw
        : 'fact';
    const salience =
      typeof row.salience === 'number' ? Math.min(1, Math.max(0, row.salience)) : 0.5;

    const entry = {
      text,
      subject: typeof row.subject === 'string' ? row.subject.trim() : '',
      kind,
      salience,
    };
    memories.add({
      ...entry,
      storyId,
      sourceMessageId: null,
      seq: maxSeq,
    });
    inserted.push(entry);
  }

  return { memories: inserted, costUsd };
}

/** Loose comparison so trivial punctuation differences do not create duplicates. */
export function normaliseForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[-*\s]+/, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
