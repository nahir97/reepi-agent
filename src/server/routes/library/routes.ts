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
import type { StoryBundle, VariantBody } from '../../../shared/api.ts';
import {
  characters,
  loadStoryBundle,
  lore,
  memories,
  messages,
  notes,
  personas,
  scenes,
  stories,
  threads,
} from '../../store/index.ts';
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
import { getDb } from '../../db.ts';

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
  stories.remove(id);
  return c.json<{ ok: true }>({ ok: true });
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

/* -- characters ---------------------------------------------------------- */

mod.get('/stories/:id/characters', (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  return c.json<Character[]>(characters.list(story.id));
});

mod.post('/stories/:id/characters', async (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');

  const body = await readBody<Partial<Character>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseCharacter(body);
  if (sanitised.rejected.length > 0) return reject(c, 'character fields', sanitised.rejected);

  return c.json<Character>(characters.create(story.id, sanitised.patch));
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
  characters.remove(id);
  return c.json<{ ok: true }>({ ok: true });
});

/* -- personas ------------------------------------------------------------ */

mod.get('/stories/:id/personas', (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');
  return c.json<Persona[]>(personas.list(story.id));
});

mod.post('/stories/:id/personas', async (c) => {
  const story = stories.get(param(c, 'id'));
  if (!story) return notFound(c, 'Story');

  const body = await readBody<Partial<Persona>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitisePersona(body);
  if (sanitised.rejected.length > 0) return reject(c, 'persona fields', sanitised.rejected);

  // The DAO clears `isDefault` on the siblings when this one is the default.
  const persona = personas.create(story.id, sanitised.patch);
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

  const story = stories.get(persona.storyId);
  if (story?.personaId === id) {
    const others = personas.list(persona.storyId).filter((candidate) => candidate.id !== id);
    const replacement = others.find((candidate) => candidate.isDefault) ?? others[0];
    stories.update(persona.storyId, { personaId: replacement?.id ?? null });
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
