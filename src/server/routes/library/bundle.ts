/**
 * Story recreation: duplication and import.
 *
 * A copy is a real copy. Every child row is re-inserted with a fresh id and every
 * foreign key remapped — including message ids referenced by memories, and scene ids
 * referenced by messages and threads — while `seq`, variant selection and the
 * story-level directive fields are preserved. Preserving the directive fields matters
 * for cost: a copy inherits its original's warm-cache-shaped prefix instead of
 * starting from a cold payload.
 */

import { getDb, transaction } from '../../db.ts';
import { newId } from '../../../shared/ids.ts';
import { DEFAULT_CONTRACT, DEFAULT_STYLE } from '../../../shared/types.ts';
import type {
  Character, DirectorNote, LoreEntry, Memory, Message, Persona, Scene, Story, Thread,
} from '../../../shared/types.ts';
import type { StoryBundle } from '../../../shared/api.ts';
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

/** A story and its children in "partial" form: what a duplicate or an import has. */
export type BundleSeed = {
  story: Partial<Story>;
  scenes?: Partial<Scene>[];
  characters?: Partial<Character>[];
  personas?: Partial<Persona>[];
  lore?: Partial<LoreEntry>[];
  memories?: Partial<Memory>[];
  threads?: Partial<Thread>[];
  messages?: Partial<Message>[];
  notes?: Partial<DirectorNote>[];
};

/**
 * `store.ts` has no `threads.create` — only `upsertOpen`, which dedupes by label
 * and cannot express a closed thread, a copied one, or one with a preserved
 * resolution time. So the one insert this module needs is written here against the
 * shared handle (`openDatabase` is called once at boot in `index.ts`); every read
 * still goes through the DAO, so row mapping stays in one place.
 */
export function insertThread(init: {
  storyId: string;
  sceneId: string | null;
  label: string;
  status: Thread['status'];
  openedAt: string | null;
  resolvedAt: string | null;
}): Thread {
  const now = Date.now();
  const thread: Thread = { id: newId(), ...init, createdAt: now, updatedAt: now };
  getDb()
    .prepare(
      `INSERT INTO threads (id, story_id, scene_id, label, status, opened_at, resolved_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      thread.id, thread.storyId, thread.sceneId, thread.label, thread.status,
      thread.openedAt, thread.resolvedAt, thread.createdAt, thread.updatedAt,
    );
  return thread;
}

export function threadStoryId(id: string): string | null {
  const row = getDb().prepare('SELECT story_id FROM threads WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  const storyId = row?.['story_id'];
  return typeof storyId === 'string' ? storyId : null;
}

export function noteStoryId(id: string): string | null {
  const row = getDb().prepare('SELECT story_id FROM notes WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  const storyId = row?.['story_id'];
  return typeof storyId === 'string' ? storyId : null;
}

/**
 * Write a whole story graph back out with fresh ids. Every child gets a new
 * primary key and every foreign key is remapped through the id maps built as we
 * go, so the copy is independent: deleting one never touches the other.
 *
 * `seq` travels with each seeded message, so the copy lands in exactly the source
 * order — a branch cut afterwards slices at the same position, and default memory
 * positions line up.
 */
export function recreateStoryBundle(
  seed: BundleSeed,
  overrides: Partial<Story> = {},
): StoryBundle {
  // Ten tables, one unit of work. A partial copy would be unrecoverable, so the
  // whole rebuild commits or nothing does.
  return transaction(() => insertBundle(seed, overrides));
}

/** The write sequence itself. Always reached through `recreateStoryBundle`. */
function insertBundle(
  seed: BundleSeed,
  overrides: Partial<Story> = {},
): StoryBundle {
  /*
   * `characterId: null` is load-bearing on both paths. A duplicated or imported
   * bundle must not carry a reference to a card id that does not exist in this
   * database; the copy's own characters are real rows inserted below. So
   * duplicating a chat yields a standalone story with its own copy of the card,
   * and importing an exported chat does the same.
   */
  const created = stories.create({ ...seed.story, ...overrides, personaId: null, characterId: null });

  const sceneIds: Record<string, string> = {};
  const copiedScenes: Scene[] = [];
  let firstScene: Scene | null = null;
  for (const scene of seed.scenes ?? []) {
    const copy = scenes.create(created.id, {
      title: scene.title,
      state: scene.state,
      notes: scene.notes,
      order: scene.order,
      archived: scene.archived,
    });
    if (scene.id !== undefined) sceneIds[scene.id] = copy.id;
    copiedScenes.push(copy);
    if (!firstScene) firstScene = copy;
  }
  if (!firstScene) {
    firstScene = scenes.create(created.id, { title: 'Opening' });
    copiedScenes.push(firstScene);
  }

  const copiedCharacters = (seed.characters ?? []).map((character) =>
    characters.create(created.id, {
      name: character.name,
      tagline: character.tagline,
      description: character.description,
      personality: character.personality,
      speech: character.speech,
      scenario: character.scenario,
      exampleDialogue: character.exampleDialogue,
      meta: character.meta,
      avatar: character.avatar,
      order: character.order,
    }),
  );

  const personaIds: Record<string, string> = {};
  const copiedPersonas: Persona[] = [];
  let firstPersona: Persona | null = null;
  for (const persona of seed.personas ?? []) {
    const copy = personas.create(created.id, {
      name: persona.name,
      description: persona.description,
      avatar: persona.avatar,
      isDefault: persona.isDefault,
    });
    if (persona.id !== undefined) personaIds[persona.id] = copy.id;
    copiedPersonas.push(copy);
    if (!firstPersona || copy.isDefault) firstPersona = copy;
  }
  if (!firstPersona) {
    firstPersona = personas.create(created.id, { name: 'You', description: '', isDefault: true });
    copiedPersonas.push(firstPersona);
  }
  const sourcePersonaId = seed.story.personaId;
  const personaId = (sourcePersonaId ? personaIds[sourcePersonaId] : undefined) ?? firstPersona.id;

  const copiedLore = (seed.lore ?? []).map((entry) =>
    lore.create(created.id, {
      title: entry.title,
      body: entry.body,
      keys: entry.keys,
      position: entry.position,
      depth: entry.depth,
      priority: entry.priority,
      weight: entry.weight,
      constant: entry.constant,
      enabled: entry.enabled,
    }),
  );

  const messageIds: Record<string, string> = {};
  const copiedMessages = (seed.messages ?? []).map((message) => {
    const sourceSceneId = message.sceneId;
    const sourceMessageId = message.id;
    const sceneId = (sourceSceneId ? sceneIds[sourceSceneId] : undefined) ?? firstScene.id;
    const copy = messages.create({
      storyId: created.id,
      sceneId,
      role: message.role ?? 'assistant',
      variants: message.variants && message.variants.length > 0 ? message.variants : [''],
      reasoning: message.reasoning,
      origin: message.origin,
      speaker: message.speaker ?? null,
      injections: message.injections,
      usage: message.usage ?? null,
      seq: message.seq,
    });
    if (sourceMessageId !== undefined) messageIds[sourceMessageId] = copy.id;
    if (message.activeVariant === undefined && message.pinned === undefined && message.disabled === undefined) {
      return copy;
    }
    // `messages.create` always selects the newest variant; a copy keeps whichever
    // variant the source had on screen, plus the writer's pin/disable flags.
    return (
      messages.update(copy.id, {
        activeVariant: message.activeVariant ?? copy.activeVariant,
        pinned: message.pinned ?? false,
        disabled: message.disabled ?? false,
      }) ?? copy
    );
  });

  const copiedMemories = (seed.memories ?? []).map((memory) => {
    const source = memory.sourceMessageId;
    return memories.add({
      storyId: created.id,
      text: memory.text ?? '',
      subject: memory.subject ?? '',
      sourceMessageId: (source ? messageIds[source] : undefined) ?? null,
      seq: memory.seq ?? copiedMessages.length,
      salience: memory.salience ?? 0.5,
      kind: memory.kind ?? 'fact',
    });
  });

  const copiedThreads = (seed.threads ?? []).map((thread) => {
    const source = thread.sceneId;
    return insertThread({
      storyId: created.id,
      sceneId: (source ? sceneIds[source] : undefined) ?? null,
      label: thread.label ?? 'Thread',
      status: thread.status ?? 'open',
      openedAt: thread.openedAt ?? null,
      resolvedAt: thread.resolvedAt ?? null,
    });
  });

  const copiedNotes = (seed.notes ?? []).map((note) => {
    const source = note.messageId;
    return notes.add({
      storyId: created.id,
      messageId: (source ? messageIds[source] : undefined) ?? null,
      kind: note.kind ?? 'observe',
      body: note.body ?? '',
      payload: note.payload ?? null,
      accepted: note.accepted ?? false,
    });
  });

  const story = stories.update(created.id, { personaId }) ?? created;

  return {
    story,
    scenes: copiedScenes,
    characters: copiedCharacters,
    personas: copiedPersonas,
    lore: copiedLore,
    messages: copiedMessages,
    memories: copiedMemories,
    threads: copiedThreads,
    notes: copiedNotes,
  };
}

/** Deep-copy a stored story. Used by `/stories/:id/duplicate` and by JSON import. */
export function cloneStoryBundle(storyId: string, overrides: Partial<Story> = {}): StoryBundle | null {
  const source = loadStoryBundle(storyId);
  if (!source) return null;
  return recreateStoryBundle(source, overrides);
}
