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

import { greetingsOf } from '../shared/greetings.ts';
import { transaction } from './db.ts';
import { expandMacros, macroContextOf } from './macros.ts';
import { cast, characters, lore, messages, personas, resolvePersona, scenes, stories } from './store/index.ts';
import type { Character, Persona, Story } from '../shared/types.ts';

export type StartChatOutcome =
  | { kind: 'created'; story: Story }
  | { kind: 'exists'; story: Story }
  | { kind: 'unknown-character' }
  /** The card has no home story left, and the caller named no story that casts it. */
  | { kind: 'orphan' };

/**
 * Start a chat with a card.
 *
 * The world it seeds from is the card's **home** story. A card whose home was
 * deleted is still chattable — it just needs a world, and `fromStoryId` supplies
 * one when that story casts the card. That is the whole recovery path for a
 * library card: the writer picks which story's world the conversation starts in.
 *
 * `greeting` chooses which of the card's openings seeds the transcript, as an
 * index into `greetingsOf(character)`. It is optional because most callers are a
 * card click with no picker in sight, and index 0 — the card's opening line — is
 * the answer there. An index that no longer resolves falls back to that line
 * rather than failing: the chat is seeded once, and the card may have been
 * edited between the picker opening and the button being pressed.
 */
export function startChat(
  characterId: string,
  options: { fromStoryId?: string; greeting?: number } = {},
): StartChatOutcome {
  const character = characters.get(characterId);
  if (!character) return { kind: 'unknown-character' };

  /* An existing conversation is handed back whatever the state of the world it
     was seeded from: the writer asked to open *that* chat, and a deleted home
     story must not turn "open chat" into an error. */
  const existing = stories.chatFor(characterId);
  if (existing) return { kind: 'exists', story: existing };

  const source = sourceStoryFor(character, options.fromStoryId);
  if (!source) return { kind: 'orphan' };

  /* A card with no home has no pool to borrow, so its chat will own the persona
     it starts with. Everything below is synchronous on a single-threaded server,
     so "check then insert" cannot interleave with another request; the unique
     index is the belt to this braces. */
  const ownsPersona = character.homeStoryId === null;
  return {
    kind: 'created',
    story: transaction(() => openChat(character, source, { ownsPersona, greeting: options.greeting })),
  };
}

/** The story a chat draws its world and persona pool from, or `null` if there is none. */
function sourceStoryFor(character: Character, fromStoryId?: string): Story | null {
  if (character.homeStoryId) return stories.get(character.homeStoryId);
  /* A card that outlived its home story: only a story that actually casts it can
     vouch for a world, so the caller cannot point the chat at an unrelated one. */
  if (!fromStoryId) return null;
  if (!cast.has(fromStoryId, character.id)) return null;
  return stories.get(fromStoryId);
}

/** The write sequence itself. Always reached through `startChat`. */
function openChat(
  character: Character,
  source: Story,
  options: { ownsPersona: boolean; greeting?: number },
): Story {
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

  /* A card with no home story has no pool to borrow, so this chat keeps the
     persona it starts with — the source story's, resolved before the chat has a
     pool of its own. Frozen *before* the greeting is rendered, because the
     greeting's `{{user}}` resolves against the chat's own context. */
  if (options.ownsPersona) freezePersonaInto(chat, resolvePersona(source));

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

  /* The card's greeting list, blank slots dropped: the picker and this reader
     must enumerate the same list, or an index means two different lines. The
     chosen slot falls back to the opening, and a card with no greeting at all
     seeds nothing — a chat is allowed to open on an empty page. */
  const greetings = greetingsOf(character);
  const greeting = greetings[options.greeting ?? 0] ?? greetings[0] ?? '';
  if (greeting) {
    /* The greeting is the one piece of authored text that becomes *transcript*,
       so its macros are resolved here, once, before it is written. Everywhere
       else a macro is re-resolved on each payload build; doing that here would
       mean rewriting a turn that has already been sent, and imported cards are
       full of `{{char}}`/`{{user}}` in exactly this field.

       The context is the chat's own, so the greeting names the persona the
       payload will use rather than a second opinion about it. */
    const rendered = expandMacros(greeting, macroContextOf(chat, scene, [])).text;
    messages.create({
      storyId: chat.id,
      sceneId: scene.id,
      role: 'assistant',
      origin: 'greeting',
      speaker: character.name,
      variants: [rendered],
    });
  }

  return chat;
}

/* ------------------------------------------------------------------ cascades */

/**
 * Keep the persona a chat was using, in the chat's own pool.
 *
 * A chat borrows its persona pool from the card's home story, so when that story
 * is deleted the borrow has nothing to resolve against. The chat would then send
 * no persona block at all and every turn the writer ever wrote would re-render as
 * "Player" — a silent loss of identity across a whole transcript, which is the
 * same failure `DELETE /personas/:id` already sweeps stories to avoid.
 *
 * Freezing is only correct here *because* the pool is gone: the rule against
 * copying a persona into a chat is about drift between two live definitions, and
 * there is no second definition left. Idempotent — a chat that already owns a
 * pool (a rescued one, or one started from a home-less card) is left alone.
 *
 * The persona is passed in rather than resolved from the chat: at the moment a
 * home-less chat is created its own pool is still empty, so resolving against
 * *it* would find nothing and freeze nothing.
 */
export function freezePersonaInto(chat: Story, persona: Persona | null): void {
  if (!persona) return;
  if (personas.list(chat.id).length > 0) return;
  const frozen = personas.create(chat.id, {
    name: persona.name,
    description: persona.description,
    avatar: persona.avatar,
    isDefault: true,
  });
  stories.update(chat.id, { personaId: frozen.id });
}

/**
 * Delete a story, keeping everything it *authored* that is not the story.
 *
 * Two things no schema can express, so one transaction does:
 *
 * - **The characters survive.** `home_story_id` is `ON DELETE SET NULL`, so the
 *   cards live on as library objects. This is the release's headline: a story is
 *   a world, not a container for its people.
 * - **Their chats survive too**, with the persona above frozen in, because a
 *   conversation is the writer's prose and a delete must not take it silently.
 *   The chats are resolved *before* the write, while the home story — and
 *   therefore the borrowed pool — still exists.
 *
 * The rest is the FK cascade: this story's cast rows, its persona pool, its
 * scenes, messages, memories, lore, threads, notes, prefixes and warm-up.
 */
export function removeStoryPreservingCast(storyId: string): { cards: Character[]; chats: Story[] } {
  const cards = characters.listByHome(storyId);
  const chats = stories.chatsForCharacters(cards.map((card) => card.id));
  return transaction(() => {
    /* Resolved while the home story — and its persona pool — still exists. */
    for (const chat of chats) freezePersonaInto(chat, resolvePersona(chat));
    stories.remove(storyId);
    return { cards, chats };
  });
}

/**
 * The chats that go with a card, and with every card a story authored.
 *
 * `character_id` is a real foreign key with `ON DELETE CASCADE`, so deleting the
 * *card* removes its chat whether or not a caller asks. These two readers exist
 * so the writer can be told what is about to happen, in the confirm that asks for
 * permission — a delete that silently takes a conversation with it is the one
 * thing this design must not do.
 */
export function chatsOfCharacter(characterId: string): Story[] {
  const chat = stories.chatFor(characterId);
  return chat ? [chat] : [];
}
