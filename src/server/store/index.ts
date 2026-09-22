/**
 * The store barrel.
 *
 * Every DAO lives in its own module; this file is the single public surface, so
 * callers keep importing `{ stories, messages, ledger }` from `../store.ts` and the
 * split stays invisible to them. That is deliberate: a re-export barrel is cheap,
 * and it means moving a DAO between files never becomes a cross-cutting edit.
 *
 * `loadStoryBundle` lives here because it is the one genuinely cross-cutting read —
 * it touches eight DAOs and belongs to none of them. The character-chat resolution
 * below (`castOf`, `personaPoolOf`, `resolvePersona`) is here for the same reason:
 * it is the single definition of what a chat borrows from the story it came from.
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
import type { Character, Persona, Story } from '../../shared/types.ts';

/* ------------------------------------------------------------ character chats */

/**
 * A chat is a story with `character_id` set, and it borrows two things from the
 * story that owns that card: the card itself, and that story's persona pool.
 *
 * These four helpers are the *only* place that resolution lives, because two
 * readers depend on it — the bundle the UI loads and the payload the composer
 * builds — and a chat that resolved its cast one way and its payload another
 * would be a silent lie about what the model was sent.
 */

/** The card a chat is about, or `null` on an ordinary story (or a missing card). */
export function chatCharacterOf(story: Story): Character | null {
  return story.characterId ? characters.get(story.characterId) : null;
}

/** What the composer and the roster see: a chat's cast is one borrowed card. */
export function castOf(story: Story): Character[] {
  if (!story.characterId) return characters.list(story.id);
  const character = chatCharacterOf(story);
  return character ? [character] : [];
}

/** The story personas live in: a chat borrows the pool of the card's home story. */
export function personaHomeId(story: Story): string {
  if (!story.characterId) return story.id;
  return chatCharacterOf(story)?.storyId ?? story.id;
}

export function personaPoolOf(story: Story): Persona[] {
  return personas.list(personaHomeId(story));
}

/**
 * The persona the model reads as `{{user}}`: the story's chosen one when it is
 * still in the pool, else the pool's default, else the first. Replaces two
 * hand-rolled copies of this order (the orchestrator's and the agents').
 */
export function resolvePersona(story: Story): Persona | null {
  const pool = personaPoolOf(story);
  if (story.personaId) {
    const chosen = pool.find((persona) => persona.id === story.personaId);
    if (chosen) return chosen;
  }
  return pool.find((persona) => persona.isDefault) ?? pool[0] ?? null;
}

/**
 * Everything a story owns, in one shot — used by export and by the UI loader.
 *
 * Assembled from the DAOs rather than one joined query: the bundle is a read model,
 * not a table, and its shape is part of the API contract. A chat's cast and persona
 * pool are borrowed (see above), so the bundle is truthful for both shapes.
 */
export function loadStoryBundle(storyId: string) {
  const story = stories.get(storyId);
  if (!story) return null;
  return {
    story,
    scenes: scenes.list(storyId, true),
    characters: castOf(story),
    personas: personaPoolOf(story),
    lore: lore.list(storyId),
    messages: messages.list(storyId),
    memories: memories.list(storyId),
    threads: threads.list(storyId),
    notes: notes.list(storyId, 200),
  };
}
