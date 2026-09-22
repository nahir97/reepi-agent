/**
 * The store barrel.
 *
 * Every DAO lives in its own module; this file is the single public surface, so
 * callers keep importing `{ stories, messages, ledger }` from `../store.ts` and the
 * split stays invisible to them. That is deliberate: a re-export barrel is cheap,
 * and it means moving a DAO between files never becomes a cross-cutting edit.
 *
 * `loadStoryBundle` lives here because it is the one genuinely cross-cutting read —
 * it touches eight DAOs and belongs to none of them.
 */

export { stories } from './stories.ts';
export { scenes } from './scenes.ts';
export { characters } from './characters.ts';
export { personas } from './personas.ts';
export { lore } from './lore.ts';
export { messages } from './messages.ts';
export { memories } from './memories.ts';
export { notes } from './notes.ts';
export { threads } from './threads.ts';
export { ledger } from './ledger.ts';
export { prefixes, type PrefixRecord } from './prefixes.ts';
export { settings } from './settings.ts';
export { warmups, type Warmup } from './warmups.ts';

/* The generic row plumbing, re-exported for callers that bind raw SQL. */
export { type Row, num, str } from './rows.ts';

export { hashContent } from '../../shared/ids.ts';

import { characters } from './characters.ts';
import { lore } from './lore.ts';
import { memories } from './memories.ts';
import { messages } from './messages.ts';
import { notes } from './notes.ts';
import { personas } from './personas.ts';
import { scenes } from './scenes.ts';
import { stories } from './stories.ts';
import { threads } from './threads.ts';

/**
 * Everything a story owns, in one shot — used by export and by the UI loader.
 *
 * Assembled from the DAOs rather than one joined query: the bundle is a read model,
 * not a table, and its shape is part of the API contract.
 */
export function loadStoryBundle(storyId: string) {
  const story = stories.get(storyId);
  if (!story) return null;
  return {
    story,
    scenes: scenes.list(storyId, true),
    characters: characters.list(storyId),
    personas: personas.list(storyId),
    lore: lore.list(storyId),
    messages: messages.list(storyId),
    memories: memories.list(storyId),
    threads: threads.list(storyId),
    notes: notes.list(storyId, 200),
  };
}
