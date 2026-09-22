/**
 * The code-shipped prompt templates.
 *
 * These are constants, not seeded rows, and the difference is the point: a release
 * can correct a starter's wording without a migration, and "edit" for a built-in
 * means "duplicate it", so the writer's library never silently changes underneath
 * them. The route merges them ahead of the stored rows and flags them
 * `builtin: true`; nothing else in the app treats them specially.
 *
 * The set is small on purpose. It exists to show the *shape* of a useful template —
 * one block, several blocks, and a macro that resolves against the story — rather
 * than to be a style catalogue.
 */

import { DEFAULT_CONTRACT } from '../shared/types.ts';
import type { PromptTemplate } from '../shared/types.ts';

/** Built-ins are not rows, so their timestamps are placeholders rather than facts. */
const AT = 0;

export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: 'builtin-narrator-contract',
    name: 'The narrator contract',
    blurb: 'The default voice and format rules. A frozen prefix from the first turn.',
    blocks: { contract: DEFAULT_CONTRACT },
    builtin: true,
    sortOrder: 0,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: 'builtin-terse-prose',
    name: 'Terse prose',
    blurb: 'Plain, concrete, short declaratives. A style block with no patience for decoration.',
    blocks: {
      style: `Voice: plain and concrete. One clause where two would do.
Pacing: action, then consequence, then stop.
Forbidden: stacked adjectives, adverbial dialogue tags, sentences that explain the one before them.`,
    },
    builtin: true,
    sortOrder: 1,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: 'builtin-second-person-present',
    name: 'Second person, present tense',
    blurb: 'A whole contract written in the present — and a worked example of a persona macro inside a frozen block.',
    blocks: {
      contract: `You are the narrator of an ongoing collaborative story, told in the present tense.

Rules of the page:
- Second person for {{user}}, third person for everyone else.
- Obey {{user}}. Never write their dialogue, thoughts, or decisions.
- Stay in the scene. No summary, no asides, no addressing the reader.
- Land every paragraph on something that has just changed.

Formatting:
- Plain prose paragraphs separated by blank lines. *Single asterisks* for emphasis only.
- Double quotes for speech, with the speaker clear from context.`,
    },
    builtin: true,
    sortOrder: 2,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: 'builtin-wry-tactile',
    name: 'Wry and tactile',
    blurb: 'Two blocks at once: a genre and a style that agree with each other.',
    blocks: {
      genre: `Genre: intimate low fantasy with a dry surface.
Tone: tactile, specific, unimpressed by its own magic.`,
      style: `Voice: close third, concrete nouns, short declaratives.
Move: one beat of action, one beat of interiority, then land on an image.
Forbidden: purple similes, em-dash pileups, "little did they know".`,
    },
    builtin: true,
    sortOrder: 3,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: 'builtin-keep-it-moving',
    name: 'Keep it moving',
    blurb: 'A post-history instruction that forbids recapping — and reads the story\u2019s own target length.',
    blocks: {
      instruct: `Write the next beat only. Do not restate, summarise, or recap anything already on the page.
Target {{targetWords}} words.`,
    },
    builtin: true,
    sortOrder: 4,
    createdAt: AT,
    updatedAt: AT,
  },
];

/** Membership, not a prefix test: stored ids are UUIDs, so the two cannot overlap. */
export function isBuiltinTemplateId(id: string): boolean {
  return BUILTIN_TEMPLATES.some((template) => template.id === id);
}
