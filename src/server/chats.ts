/**
 * Character chats.
 *
 * A chat is a story with `character_id` set — the same transcript, the same
 * single-message history block, the same cache accounting, the same ledger, the
 * same scenes and settings. The only difference is that it borrows its cast (one
 * card) and its persona pool from the story that owns that card, resolved in one
 * place by `store/index.ts`. Nothing here invents a second kind of session, which
 * is why every existing story surface — composer, inspector, insights, export —
 * works inside a chat unchanged.
 *
 * Starting one copies the **world, never the transcript**:
 *
 * - Copied: the directive blocks (contract, genre, style, bible, scenario,
 *   exemplars), the writing settings (model, effort, sampling, budgets, prefill,
 *   theme), the anchored lore, and the writer's active persona.
 * - Not copied: turns, memories, threads, director notes, the synopsis, and
 *   `instruct` — the last because a post-history instruction is a directive about
 *   the turn being written, not a fact about the world, and the chat's own
 *   settings are where a writer adds one.
 * - Seeded: the card's greeting, as the opening assistant turn, so a chat opens
 *   on the character speaking rather than on an empty page.
 *
 * One chat per character. That is enforced twice on purpose: `chatFor` gives the
 * caller a row to open instead of an error, and the partial unique index in
 * `db.ts` makes a second row impossible even if two requests race. The index is
 * the only thing standing between "one chat each" and "a chat list per card", so
 * it is also how that decision would be reversed.
 */

import { greetingOf } from './cards.ts';
import { transaction } from './db.ts';
import { characters, lore, messages, scenes, stories } from './store/index.ts';
import type { Character, Story } from '../shared/types.ts';

export type StartChatOutcome =
  | { kind: 'created'; story: Story }
  | { kind: 'exists'; story: Story }
  | { kind: 'unknown-character' }
  /** The card exists but the story that owns it does not — a hand-edited database. */
  | { kind: 'orphan' };

export function startChat(characterId: string): StartChatOutcome {
  const character = characters.get(characterId);
  if (!character) return { kind: 'unknown-character' };

  const source = stories.get(character.storyId);
  if (!source) return { kind: 'orphan' };

  /* Every guard above and below is synchronous on a single-threaded server, so
     "check then insert" cannot interleave with another request. The unique index
     is the belt to this braces. */
  const existing = stories.chatFor(characterId);
  if (existing) return { kind: 'exists', story: existing };

  return { kind: 'created', story: transaction(() => openChat(character, source)) };
}

/** The write sequence itself. Always reached through `startChat`. */
function openChat(character: Character, source: Story): Story {
  const chat = stories.create({
    title: character.name.trim() || 'Chat',
    characterId: character.id,

    /* The world. */
    contract: source.contract,
    genre: source.genre,
    style: source.style,
    bible: source.bible,
    scenario: source.scenario,
    exemplars: source.exemplars,

    /* How the story is written, so the chat reads as the same pen. */
    model: source.model,
    effort: source.effort,
    temperature: source.temperature,
    topP: source.topP,
    maxTokens: source.maxTokens,
    targetWords: source.targetWords,
    prefill: source.prefill,
    theme: source.theme,
    loreBudget: source.loreBudget,
    historyBudget: source.historyBudget,

    /* The writer, as the source story had them. A chat that has no persona of its
       own resolves through this id against the borrowed pool. */
    personaId: source.personaId,
  });

  const scene = scenes.create(chat.id, { title: 'Opening' });

  /* Anchored lore is world canon and costs nothing to carry. Entries at depth,
     before or after are keyed to the group story's turns — copied here they would
     fire detached from the triggers that used to summon them. */
  for (const entry of lore.list(source.id)) {
    if (entry.position !== 'anchor') continue;
    lore.create(chat.id, {
      title: entry.title,
      body: entry.body,
      keys: entry.keys,
      position: entry.position,
      depth: entry.depth,
      priority: entry.priority,
      weight: entry.weight,
      constant: entry.constant,
      enabled: entry.enabled,
    });
  }

  const greeting = greetingOf(character);
  if (greeting) {
    messages.create({
      storyId: chat.id,
      sceneId: scene.id,
      role: 'assistant',
      origin: 'greeting',
      speaker: character.name,
      variants: [greeting],
    });
  }

  return chat;
}

/* ------------------------------------------------------------------ cascades */

/**
 * The chats that go with a card, and with every card a story owns.
 *
 * `character_id` is a real foreign key with `ON DELETE CASCADE`, so the database
 * removes these rows whether or not a caller asks. These two readers exist so the
 * *writer* can be told what is about to disappear, in the confirm that asks for
 * permission — a delete that silently takes a conversation with it is the one
 * thing this design must not do.
 */
export function chatsOfCharacter(characterId: string): Story[] {
  const chat = stories.chatFor(characterId);
  return chat ? [chat] : [];
}

export function chatsOfStory(storyId: string): Story[] {
  return stories.chatsForCharacters(characters.list(storyId).map((character) => character.id));
}
