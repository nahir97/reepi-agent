/**
 * Library routes.
 *
 * Every handler follows one shape: resolve the path parameter, guard that the row
 * exists, read and sanitise the body, then act. The guard is not ceremony — a PATCH
 * against a deleted entity has to be a 404, never a silent no-op that the client
 * reads as success.
 */

import { Hono } from 'hono';
import { asBool, asInt, asString, fail, notFound, readBody } from '../../http.ts';
import { newId } from '../../../shared/ids.ts';
import { TEMPLATES, type StoryCreateBody } from '../../../shared/api.ts';
import { DEFAULT_CONTRACT, DEFAULT_STYLE, EFFORT_LABELS, MODELS } from '../../../shared/types.ts';
import type {
  Character, DirectorNote, LoreEntry, Message, MessageOrigin, MessageUsage, ModelId, Persona,
  ReasoningEffort, Role, Scene, SceneStateField, Story, Theme, Thread,
} from '../../../shared/types.ts';
import type { CastAttachBody, CastIndex, StartChatBody, StoryBundle, VariantBody } from '../../../shared/api.ts';
import {
  cast,
  castOf,
  characters,
  loadStoryBundle,
  lore,
  memories,
  messages,
  notes,
  personaHomeId,
  personaPoolOf,
  personas,
  scenes,
  stories,
  threads,
} from '../../store/index.ts';
import { chatsOfCharacter, removeStoryPreservingCast, startChat } from '../../chats.ts';
import { param, reject } from './shared.ts';
import {
  sanitiseCharacter,
  sanitiseLore,
  sanitiseMemory,
  sanitiseMessage,
  sanitiseNote,
  sanitisePersona,
  sanitiseScene,
  sanitiseStory,
  sanitiseThread,
} from './sanitise.ts';
import { cloneStoryBundle, insertThread, noteStoryId, threadStoryId } from './bundle.ts';
import { getDb, transaction } from '../../db.ts';

const mod = new Hono();

/* -- stories -------------------------------------------------------------- */

mod.get('/stories', (c) => c.json<Story[]>(stories.list()));

mod.post('/stories', async (c) => {
  const body = await readBody<StoryCreateBody>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const title = asString(body.title).trim();
  if (!title) return fail(c, 400, 'Invalid body', 'A story needs a title.');

  const sanitised = sanitiseStory(body);
  if (sanitised.rejected.length > 0) return reject(c, 'story fields', sanitised.rejected);
  const patch = sanitised.patch;

  const template = body.template;
  const seed: Partial<Story> =
    typeof template === 'string' && template in TEMPLATES ? TEMPLATES[template].seed : {};

  const story = stories.create({
    ...seed,
    ...patch,
    title,
    // Frozen prefix blocks: the cache is useless without a contract, so one
    // always exists, and the body still wins when it supplies its own.
    contract: patch.contract ?? seed.contract ?? DEFAULT_CONTRACT,
    style: patch.style ?? seed.style ?? DEFAULT_STYLE,
    instruct: patch.instruct ?? seed.instruct ?? '',
    personaId: null,
  });

  const scene = scenes.create(story.id, { title: 'Opening' });
  const persona = personas.create(story.id, { name: 'You', description: '', isDefault: true });
  const linked = stories.update(story.id, { personaId: persona.id }) ?? story;

  return c.json<Story>(linked);
});

mod.get('/stories/:id/bundle', (c) => {
  const bundle = loadStoryBundle(param(c, 'id'));
  return bundle ? c.json<StoryBundle>(bundle) : notFound(c, 'Story');
});

mod.patch('/stories/:id', async (c) => {
  const id = param(c, 'id');
  if (!stories.get(id)) return notFound(c, 'Story');

  const body = await readBody<Partial<Story>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseStory(body);
  if (sanitised.rejected.length > 0) return reject(c, 'story fields', sanitised.rejected);

  const updated = stories.update(id, sanitised.patch);
  return updated ? c.json<Story>(updated) : notFound(c, 'Story');
});

mod.delete('/stories/:id', (c) => {
  const id = param(c, 'id');
  if (!stories.get(id)) return notFound(c, 'Story');
  /* The characters this story authored are not deleted with it, and neither are
     their chats — `removeStoryPreservingCast` freezes the borrowed persona in
     before the row goes. Both are reported so the confirm can name them. */
  const { cards, chats } = removeStoryPreservingCast(id);
  return c.json<{ ok: true; characters: string[]; chats: string[] }>({
    ok: true,
    characters: cards.map((card) => card.name),
    chats: chats.map((chat) => chat.title),
  });
});

mod.post('/stories/:id/duplicate', (c) => {
  const clone = cloneStoryBundle(param(c, 'id'), {});
  if (!clone) return notFound(c, 'Story');
  const titled = stories.update(clone.story.id, { title: `${clone.story.title} (copy)` }) ?? clone.story;
  return c.json<Story>(titled);
});

/* -- scenes -------------------------------------------------------------- */

mod.get('/stories/:id/scenes', (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  return c.json<Scene[]>(scenes.list(story.id, asBool(c.req.query('archived'), false)));
});

mod.post('/stories/:id/scenes', async (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');

  const body = await readBody<Partial<Scene>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseScene(body);
  if (sanitised.rejected.length > 0) return reject(c, 'scene fields', sanitised.rejected);

  return c.json<Scene>(scenes.create(story.id, sanitised.patch));
});

mod.patch('/scenes/:id', async (c) => {
  const id = param(c, 'id');
  if (!scenes.get(id)) return notFound(c, 'Scene');

  const body = await readBody<Partial<Scene>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseScene(body);
  if (sanitised.rejected.length > 0) return reject(c, 'scene fields', sanitised.rejected);

  const updated = scenes.update(id, sanitised.patch);
  return updated ? c.json<Scene>(updated) : notFound(c, 'Scene');
});

mod.delete('/scenes/:id', (c) => {
  const id = param(c, 'id');
  if (!scenes.get(id)) return notFound(c, 'Scene');
  scenes.remove(id);
  return c.json<{ ok: true }>({ ok: true });
});

/* -- characters and casts ------------------------------------------------- */

/**
 * Every character in the library, with its cast memberships.
 *
 * App-scoped, because a card is: `/api/characters`, not
 * `/api/stories/:id/characters`. The Cast page's `Library` scope reads it, and so
 * does the delete confirm — a card can be cast in stories the client never loaded.
 */
mod.get('/characters', (c) => {
  return c.json<CastIndex>({ characters: characters.list(), casts: cast.all() });
});

/** A story's payload cast: one borrowed card for a chat, `story_cast` otherwise. */
mod.get('/stories/:id/characters', (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  return c.json<Character[]>(castOf(story));
});

/**
 * Write a new card in this story, cast here.
 *
 * Card and home membership are two rows, so they commit together.
 * `characters.create` stays flat because `insertBundle` already supplies a
 * transaction and `transaction()` is not re-entrant.
 *
 * The cast of a chat is borrowed, not written: it is exactly the card the chat was
 * started from. Letting this create a row anyway would insert a character the
 * composer never reads — an invisible orphan that looks like a successful save.
 */
mod.post('/stories/:id/characters', async (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  if (story.characterId) {
    return fail(c, 400, 'A chat has exactly one character', 'Edit that card, or start a chat from another one.');
  }

  const body = await readBody<Partial<Character>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseCharacter(body);
  if (sanitised.rejected.length > 0) return reject(c, 'character fields', sanitised.rejected);

  return c.json<Character>(transaction(() => characters.create(story.id, sanitised.patch)));
});

/**
 * Adopt an existing card into this story's cast.
 *
 * The reason the library exists: a blank story gets a cast without anyone being
 * written twice. The card keeps one definition and one home, so editing it later
 * edits it in every story that casts it — a reference, not a copy.
 */
mod.post('/stories/:id/cast', async (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  /* A chat's cast is its `character_id`, by definition. A member row would be a
     second opinion about the payload, and the composer reads the first. */
  if (story.characterId) {
    return fail(c, 400, 'A chat has exactly one character', 'A cast cannot be added to.');
  }

  const body = await readBody<CastAttachBody>(c);
  const characterId = asString(body?.characterId).trim();
  if (!characterId) return fail(c, 400, 'Invalid body', 'Expected { characterId }.');
  if (!characters.get(characterId)) return notFound(c, 'Character');

  // Idempotent: re-adding a card that is already cast is a no-op, not a 409.
  if (!cast.has(story.id, characterId)) cast.add(story.id, characterId);
  return c.json<Character[]>(cast.listForStory(story.id));
});

/**
 * Drop a card from this story's cast, leaving the card — and every other story
 * that casts it — untouched.
 *
 * The home story cannot be detached: the card would keep its home and its chat
 * while vanishing from the only cast that authored it. That is a delete, and
 * there is already a control for it.
 */
mod.delete('/stories/:id/cast/:characterId', (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  const characterId = param(c, 'characterId');
  const character = characters.get(characterId);
  if (!character) return notFound(c, 'Character');
  if (!cast.has(story.id, characterId)) return notFound(c, 'Cast member');
  if (character.homeStoryId === story.id) {
    return fail(c, 400, 'This card belongs to this story', 'Delete the character instead.');
  }
  cast.remove(story.id, characterId);
  return c.json<{ ok: true }>({ ok: true });
});

/**
 * Start the 1:1 chat with this character, or hand back the one that already
 * exists. One chat per character, so this is not "create" so much as "open
 * or create" — re-clicking a card must land in the conversation it started.
 *
 * `fromStoryId` is only consulted for a card whose home story is gone, and must
 * name a story that casts it: the world a chat draws from has to be one the
 * writer can actually see the card in.
 */
mod.post('/characters/:id/chat', async (c) => {
  const body = await readBody<StartChatBody>(c);
  const fromStoryId = asString(body?.fromStoryId).trim() || undefined;
  const outcome = startChat(param(c, 'id'), { fromStoryId });
  if (outcome.kind === 'unknown-character') return notFound(c, 'Character');
  if (outcome.kind === 'orphan') {
    return fail(
      c,
      409,
      'This character has no world to draw from',
      'Its home story is gone, and this story does not cast it. Open a story that casts it and start the chat there.',
    );
  }
  if (outcome.kind === 'exists') {
    return fail(c, 409, 'This character already has a chat', outcome.story.title);
  }
  return c.json<Story>(outcome.story);
});

mod.patch('/characters/:id', async (c) => {
  const id = param(c, 'id');
  if (!characters.get(id)) return notFound(c, 'Character');

  const body = await readBody<Partial<Character>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseCharacter(body);
  if (sanitised.rejected.length > 0) return reject(c, 'character fields', sanitised.rejected);

  const updated = characters.update(id, sanitised.patch);
  return updated ? c.json<Character>(updated) : notFound(c, 'Character');
});

mod.delete('/characters/:id', (c) => {
  const id = param(c, 'id');
  if (!characters.get(id)) return notFound(c, 'Character');
  /* The chat goes with the card by foreign key, and so does every cast row —
     which is why both are read *before* the delete. Naming the affected stories
     is what lets a client say the card is leaving more than the one you see. */
  const chats = chatsOfCharacter(id);
  const storyIds = cast.storyIdsFor(id);
  characters.remove(id);
  return c.json<{ ok: true; chats: string[]; storyIds: string[] }>({
    ok: true,
    chats: chats.map((chat) => chat.title),
    storyIds,
  });
});

/* -- personas ------------------------------------------------------------ */

mod.get('/stories/:id/personas', (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  return c.json<Persona[]>(personaPoolOf(story));
});

mod.post('/stories/:id/personas', async (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');

  const body = await readBody<Partial<Persona>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitisePersona(body);
  if (sanitised.rejected.length > 0) return reject(c, 'persona fields', sanitised.rejected);

  /* A chat owns no personas: it borrows the card's home story's pool, so a new
     persona written inside a chat is added to that pool — otherwise it would be
     invisible to the very chat that just created it. The *selection* still lands
     on this story, so a chat adopting its new default persona is immediate. */
  const home = personaHomeId(story);
  // The DAO clears `isDefault` on the siblings when this one is the default.
  const persona = personas.create(home, sanitised.patch);
  if (persona.isDefault && story.personaId !== persona.id) {
    stories.update(story.id, { personaId: persona.id });
  }
  return c.json<Persona>(persona);
});

mod.patch('/personas/:id', async (c) => {
  const id = param(c, 'id');
  const existing = personas.get(id);
  if (!existing) return notFound(c, 'Persona');

  const body = await readBody<Partial<Persona>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitisePersona(body);
  if (sanitised.rejected.length > 0) return reject(c, 'persona fields', sanitised.rejected);

  const updated = personas.update(id, sanitised.patch);
  if (!updated) return notFound(c, 'Persona');
  if (updated.isDefault) {
    const story = stories.get(updated.storyId);
    if (story && story.personaId !== updated.id) stories.update(story.id, { personaId: updated.id });
  }
  return c.json<Persona>(updated);
});

mod.delete('/personas/:id', (c) => {
  const id = param(c, 'id');
  const persona = personas.get(id);
  if (!persona) return notFound(c, 'Persona');

  /* Every story that had this persona selected must be re-pointed, not only the
     story that owns the row: a character chat borrows this pool, so its
     `persona_id` can refer to a persona outside itself. Without this sweep a
     chat would keep a dangling id and silently send no persona block at all. */
  const referencing = stories.list().filter((story) => story.personaId === id);
  for (const story of referencing) {
    const pool = personaPoolOf(story).filter((candidate) => candidate.id !== id);
    const replacement = pool.find((candidate) => candidate.isDefault) ?? pool[0] ?? null;
    stories.update(story.id, { personaId: replacement?.id ?? null });
  }

  personas.remove(id);
  return c.json<{ ok: true }>({ ok: true });
});

/* -- messages ------------------------------------------------------------ */

/**
 * Turn mutation.
 *
 * These four routes are what makes a turn editable rather than append-only:
 * `PATCH` covers pin/exclude/attribution (and inline edits, which arrive as a
 * rewritten `variants` array — all variants are rewritten together so a sibling
 * generation is never silently left stale), `DELETE` drops a turn, and the
 * `variant` route switches or rewrites one candidate.
 *
 * Every one of them returns the stored row, so the client can reconcile against
 * what the database actually holds instead of trusting its optimistic guess.
 */
mod.patch('/messages/:id', async (c) => {
  const id = param(c, 'id');
  const existing = messages.get(id);
  if (!existing) return notFound(c, 'Message');

  const body = await readBody<Partial<Message>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseMessage(body);
  if (sanitised.rejected.length > 0) return reject(c, 'message fields', sanitised.rejected);

  const updated = messages.update(id, sanitised.patch);
  if (!updated) return notFound(c, 'Message');
  return c.json<Message>(updated);
});

mod.delete('/messages/:id', (c) => {
  const id = param(c, 'id');
  if (!messages.get(id)) return notFound(c, 'Message');
  messages.remove(id);
  return c.json({ ok: true });
});

mod.post('/messages/:id/variant', async (c) => {
  const id = param(c, 'id');
  const existing = messages.get(id);
  if (!existing) return notFound(c, 'Message');

  const body = await readBody<VariantBody>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  // Rewriting text and selecting an index are separate intents; do not let a
  // malformed `index` block a perfectly good `text` edit.
  let updated: Message | null = existing;
  if (typeof body.text === 'string') {
    updated = messages.setVariantText(id, existing.activeVariant, body.text);
    if (!updated) return notFound(c, 'Message');
  }
  if (body.index !== undefined) {
    const index = Number(body.index);
    if (!Number.isInteger(index) || index < 0 || index >= existing.variants.length) {
      return fail(c, 400, 'Invalid index', `Expected an integer in 0..${existing.variants.length - 1}.`);
    }
    updated = messages.update(id, { activeVariant: index });
  }
  if (!updated) return notFound(c, 'Message');
  return c.json<Message>(updated);
});

/* -- lore ---------------------------------------------------------------- */

mod.get('/stories/:id/lore', (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  return c.json<LoreEntry[]>(lore.list(story.id));
});

mod.post('/stories/:id/lore', async (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');

  const body = await readBody<Partial<LoreEntry>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseLore(body);
  if (sanitised.rejected.length > 0) return reject(c, 'lore fields', sanitised.rejected);

  return c.json<LoreEntry>(lore.create(story.id, sanitised.patch));
});

mod.patch('/lore/:id', async (c) => {
  const id = param(c, 'id');
  if (!lore.get(id)) return notFound(c, 'Lore entry');

  const body = await readBody<Partial<LoreEntry>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseLore(body);
  if (sanitised.rejected.length > 0) return reject(c, 'lore fields', sanitised.rejected);

  const updated = lore.update(id, sanitised.patch);
  return updated ? c.json<LoreEntry>(updated) : notFound(c, 'Lore entry');
});

mod.delete('/lore/:id', (c) => {
  const id = param(c, 'id');
  if (!lore.get(id)) return notFound(c, 'Lore entry');
  lore.remove(id);
  return c.json<{ ok: true }>({ ok: true });
});

/* -- notes --------------------------------------------------------------- */

mod.get('/stories/:id/notes', (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  return c.json<DirectorNote[]>(notes.list(story.id, asInt(c.req.query('limit'), 60)));
});

mod.post('/notes/:id/accept', (c) => {
  const id = param(c, 'id');
  const storyId = noteStoryId(id);
  if (!storyId) return notFound(c, 'Note');

  const note = notes.list(storyId, 1000).find((candidate) => candidate.id === id);
  if (!note) return notFound(c, 'Note');

  notes.setAccepted(id, true);
  return c.json<DirectorNote>({ ...note, accepted: true });
});

mod.delete('/notes/:id', (c) => {
  const id = param(c, 'id');
  if (!noteStoryId(id)) return notFound(c, 'Note');
  notes.remove(id);
  return c.json<{ ok: true }>({ ok: true });
});

/* -- threads ------------------------------------------------------------- */

mod.get('/stories/:id/threads', (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  return c.json<Thread[]>(threads.list(story.id));
});

mod.post('/stories/:id/threads', async (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');

  const body = await readBody<Partial<Thread>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseThread(body);
  if (sanitised.rejected.length > 0) return reject(c, 'thread fields', sanitised.rejected);

  const label = (sanitised.patch.label ?? '').trim();
  if (!label) return fail(c, 400, 'Invalid thread', 'A thread needs a label.');

  const status = sanitised.patch.status ?? 'open';
  const now = new Date().toISOString();
  return c.json<Thread>(
    insertThread({
      storyId: story.id,
      sceneId: sanitised.patch.sceneId ?? null,
      label,
      status,
      openedAt: sanitised.patch.openedAt ?? (status === 'open' ? now : null),
      resolvedAt: sanitised.patch.resolvedAt ?? (status === 'closed' ? now : null),
    }),
  );
});

mod.patch('/threads/:id', async (c) => {
  const id = param(c, 'id');
  const storyId = threadStoryId(id);
  if (!storyId) return notFound(c, 'Thread');

  const existing = threads.list(storyId).find((candidate) => candidate.id === id);
  if (!existing) return notFound(c, 'Thread');

  const body = await readBody<Partial<Thread>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseThread(body);
  if (sanitised.rejected.length > 0) return reject(c, 'thread fields', sanitised.rejected);

  const merged: Thread = {
    ...existing,
    ...sanitised.patch,
    id,
    storyId: existing.storyId,
    updatedAt: Date.now(),
  };

  getDb()
    .prepare(
      'UPDATE threads SET scene_id=?, label=?, status=?, opened_at=?, resolved_at=?, updated_at=? WHERE id=?',
    )
    .run(merged.sceneId, merged.label, merged.status, merged.openedAt, merged.resolvedAt, merged.updatedAt, id);

  return c.json<Thread>(merged);
});

mod.delete('/threads/:id', (c) => {
  const id = param(c, 'id');
  if (!threadStoryId(id)) return notFound(c, 'Thread');
  threads.remove(id);
  return c.json<{ ok: true }>({ ok: true });
});

export default mod;
