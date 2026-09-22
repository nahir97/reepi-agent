/**
 * Characters persistence, and the casts they belong to.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 *
 * Two related tables share this module. `characters` holds one definition each
 * — a library object with a *home* story, not a child of it. `story_cast` says
 * which stories have it in the payload; the home story gets a row at creation,
 * and any other story gets one by adoption. Order lives on the membership,
 * because two stories can put the same card in different positions.
 */

import { getDb, parseJson } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { estimateTokens } from '../../shared/tokens.ts';
import { type Row, num, str } from './rows.ts';
import type { Character } from '../../shared/types.ts';

function toCharacter(row: Row): Character {
  return {
    id: str(row.id),
    /* Null once the home story is gone: the card outlives it. */
    homeStoryId:
      row.home_story_id === null || row.home_story_id === undefined ? null : str(row.home_story_id),
    name: str(row.name),
    tagline: str(row.tagline),
    description: str(row.description),
    personality: str(row.personality),
    speech: str(row.speech),
    scenario: str(row.scenario),
    exampleDialogue: str(row.example_dialogue),
    meta: parseJson<Record<string, unknown>>(row.meta, {}),
    avatar: row.avatar === null || row.avatar === undefined ? null : str(row.avatar),
    tokens: num(row.tokens),
    order: num(row.sort_order),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

/** The next position in a story's cast. Shared by creation and adoption. */
function nextCastOrder(storyId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM story_cast WHERE story_id = ?')
    .get(storyId) as Row | undefined;
  return num(row?.m, -1) + 1;
}

/* --------------------------------------------------------------- characters */

export const characters = {
  /** Every card in the library, newest edit first. */
  list(): Character[] {
    const rows = getDb()
      .prepare('SELECT * FROM characters ORDER BY updated_at DESC')
      .all() as Row[];
    return rows.map(toCharacter);
  },

  /**
   * The cards a story *authored* — its home cast, not its payload cast.
   * The payload cast is `cast.listForStory`; this one answers "what did this
   * story write", which is what a delete has to preserve.
   */
  listByHome(storyId: string): Character[] {
    const rows = getDb()
      .prepare('SELECT * FROM characters WHERE home_story_id = ? ORDER BY sort_order, created_at')
      .all(storyId) as Row[];
    return rows.map(toCharacter);
  },

  get(id: string): Character | null {
    const row = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row | undefined;
    return row ? toCharacter(row) : null;
  },

  /**
   * Create a card, cast in the story that authored it.
   *
   * Two rows — the definition and its home membership — so this belongs inside a
   * `transaction(...)` when it is the only write in flight (`writeStoryBundle` is
   * already wrapped, and `transaction` is not re-entrant, which is why this DAO
   * does not open one itself). Token counts are derived, so they are always
   * recomputed on write.
   *
   * A **null home** means a library card with no world yet: the assistant can
   * write a character before any story exists, and any story can adopt it later.
   * That is one row, not two — there is no cast to be a member of — which is the
   * same state a card reaches when the story that authored it is deleted.
   */
  create(homeStoryId: string | null, init: Partial<Character> = {}): Character {
    const now = Date.now();
    const order = init.order ?? (homeStoryId ? nextCastOrder(homeStoryId) : 0);

    const character: Character = {
      id: newId(),
      homeStoryId,
      name: init.name ?? 'New Character',
      tagline: init.tagline ?? '',
      description: init.description ?? '',
      personality: init.personality ?? '',
      speech: init.speech ?? '',
      scenario: init.scenario ?? '',
      exampleDialogue: init.exampleDialogue ?? '',
      meta: init.meta ?? {},
      avatar: init.avatar ?? null,
      tokens: 0,
      order,
      createdAt: now,
      updatedAt: now,
    };
    character.tokens = characterCardTokens(character);

    getDb()
      .prepare(
        `INSERT INTO characters (
           id, home_story_id, name, tagline, description, personality, speech, scenario,
           example_dialogue, meta, avatar, tokens, sort_order, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        character.id, character.homeStoryId, character.name, character.tagline, character.description,
        character.personality, character.speech, character.scenario, character.exampleDialogue,
        JSON.stringify(character.meta), character.avatar, character.tokens, character.order,
        character.createdAt, character.updatedAt,
      );

    /* The home story is a cast like any other. Without this row the card would
       exist but never reach a payload — a silent orphan. A card with no home has
       no cast to join, and is adopted on purpose or not at all. */
    if (homeStoryId) {
      getDb()
        .prepare(
          'INSERT INTO story_cast (story_id, character_id, sort_order, created_at) VALUES (?,?,?,?)',
        )
        .run(homeStoryId, character.id, character.order, now);
    }

    return character;
  },

  update(id: string, patch: Partial<Character>): Character | null {
    const existing = characters.get(id);
    if (!existing) return null;
    /* `homeStoryId` is deliberately not patchable: a card's origin is set once,
       and re-homing it would silently move the world its chat draws from. */
    const merged: Character = { ...existing, ...patch, id, homeStoryId: existing.homeStoryId, updatedAt: Date.now() };
    merged.tokens = characterCardTokens(merged);

    getDb()
      .prepare(
        `UPDATE characters SET
           name=?, tagline=?, description=?, personality=?, speech=?, scenario=?,
           example_dialogue=?, meta=?, avatar=?, tokens=?, sort_order=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        merged.name, merged.tagline, merged.description, merged.personality, merged.speech,
        merged.scenario, merged.exampleDialogue, JSON.stringify(merged.meta), merged.avatar,
        merged.tokens, merged.order, merged.updatedAt, id,
      );

    /* Order is a cast property now, so a home-cast reorder keeps its row in step.
       Nothing in the UI sends `order`; the copy path sets it at creation. */
    if (patch.order !== undefined && existing.homeStoryId) {
      getDb()
        .prepare('UPDATE story_cast SET sort_order = ? WHERE story_id = ? AND character_id = ?')
        .run(merged.order, existing.homeStoryId, id);
    }

    return merged;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM characters WHERE id = ?').run(id);
  },
};

/* -------------------------------------------------------------------- cast */

/**
 * Which stories a card is cast in.
 *
 * The membership row is the *only* thing `castOf` reads for an ordinary story,
 * so this table — not `characters.sort_order` — is what puts cards, and their
 * order, into a payload.
 */
export const cast = {
  /** The cards in a story's payload, in cast order. */
  listForStory(storyId: string): Character[] {
    const rows = getDb()
      .prepare(
        `SELECT c.* FROM story_cast sc
         JOIN characters c ON c.id = sc.character_id
         WHERE sc.story_id = ?
         ORDER BY sc.sort_order, sc.created_at`,
      )
      .all(storyId) as Row[];
    return rows.map(toCharacter);
  },

  /** Every membership, for the library read model and the delete confirm. */
  all(): { storyId: string; characterId: string }[] {
    const rows = getDb()
      .prepare('SELECT story_id, character_id FROM story_cast')
      .all() as Row[];
    return rows.map((row) => ({ storyId: str(row.story_id), characterId: str(row.character_id) }));
  },

  has(storyId: string, characterId: string): boolean {
    const row = getDb()
      .prepare('SELECT 1 AS one FROM story_cast WHERE story_id = ? AND character_id = ?')
      .get(storyId, characterId) as Row | undefined;
    return row !== undefined;
  },

  /**
   * Adopt an existing card into a story, appended to its cast. Idempotent: the
   * caller checks `has` first (synchronous, single-threaded server), and the
   * primary key makes a racing double insert impossible.
   */
  add(storyId: string, characterId: string): void {
    getDb()
      .prepare(
        'INSERT OR IGNORE INTO story_cast (story_id, character_id, sort_order, created_at) VALUES (?,?,?,?)',
      )
      .run(storyId, characterId, nextCastOrder(storyId), Date.now());
  },

  remove(storyId: string, characterId: string): void {
    getDb()
      .prepare('DELETE FROM story_cast WHERE story_id = ? AND character_id = ?')
      .run(storyId, characterId);
  },

  /** The stories that would be affected by deleting a card. Read before it is. */
  storyIdsFor(characterId: string): string[] {
    const rows = getDb()
      .prepare('SELECT story_id FROM story_cast WHERE character_id = ?')
      .all(characterId) as Row[];
    return rows.map((row) => str(row.story_id));
  },
};

/** Tokens a card contributes once it is rendered into the cast block. */
function characterCardTokens(character: Character): number {
  const body = [
    character.name,
    character.tagline,
    character.description,
    character.personality,
    character.speech,
    character.scenario,
  ]
    .filter(Boolean)
    .join('\n');
  return estimateTokens(body);
}
