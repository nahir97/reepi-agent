/**
 * The Summariser pass — rolling synopsis compression.
 *
 * It compresses exactly the head of the transcript that the composer's history
 * budget would otherwise drop, leaving the recent tail verbatim. Separate because
 * its no-op cases — a story too short to be worth compressing — are its own
 * concern, not a shared one.
 */

import type { ModelId } from '../../shared/types.ts';
import type { SummaryResult } from '../../shared/api.ts';
import { completeChat } from '../deepseek.ts';
import { messages } from '../store/index.ts';
import {
  buildTranscriptView,
  personaNameFor,
  recordSideCall,
  renderTranscript,
  requireStory,
} from './context.ts';

export const SUMMARISER_SYSTEM = `You compress fiction transcripts into a rolling synopsis.

Write dense, factual, third-person past tense. Preserve: who did what to whom, what changed, what was promised or threatened, and what is still unresolved. Compress away: atmosphere, gestures, and any prose you cannot turn into a fact.

Hard rules:
- Plain prose, 120-220 words, no headings, no bullet points, no quotes.
- Name people explicitly; never use a pronoun without an antecedent in the same sentence.
- Keep every unresolved thread in play — that is the synopsis's main job.
- Do not invent anything. If it is not in the transcript, it does not exist.`;

export async function runSummarise(
  storyId: string,
  options: { model?: ModelId; keepVerbatim?: number; signal?: AbortSignal } = {},
): Promise<SummaryResult> {
  const story = requireStory(storyId);
  const all = messages.list(storyId);

  // Normal mode keeps the recent tail verbatim and compresses only what the
  // composer's history budget would drop. On a short story that tail covers
  // everything, so an explicit request falls back to compressing all but the last
  // two messages rather than silently doing nothing.
  const keep = options.keepVerbatim ?? 12;
  let head = all.length > keep ? all.slice(0, all.length - keep) : [];

  if (head.length === 0) {
    if (all.length <= 3) {
      return {
        synopsis: story.synopsis,
        costUsd: 0,
        compressed: 0,
        note: 'Only a few turns so far — a synopsis would cost more than it saves. Nothing to compress yet.',
      };
    }
    head = all.slice(0, Math.max(1, all.length - 2));
  }

  const view = buildTranscriptView(head, personaNameFor(storyId), head.length);
  if (view.length === 0) {
    return {
      synopsis: story.synopsis,
      costUsd: 0,
      compressed: 0,
      note: 'There is no transcript text to compress yet.',
    };
  }

  const model = options.model ?? 'deepseek-flash';
  const result = await completeChat({
    model,
    effort: 'none',
    maxTokens: 700,
    messages: [
      { role: 'system', content: SUMMARISER_SYSTEM },
      {
        role: 'user',
        content: [
          story.synopsis
            ? `Existing synopsis, to extend:\n${story.synopsis}`
            : 'There is no existing synopsis yet.',
          `\nTranscript:\n${renderTranscript(view)}`,
        ].join('\n'),
      },
    ],
    signal: options.signal,
  });

  const costUsd = recordSideCall('summarise', storyId, model, result);
  const synopsis = result.text.trim();
  if (!synopsis) {
    return {
      synopsis: story.synopsis,
      costUsd,
      compressed: 0,
      note: 'The model returned no summary. The existing synopsis was left untouched.',
    };
  }
  return { synopsis, costUsd, compressed: head.length };
}
