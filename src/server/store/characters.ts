/**
 * Characters persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb, parseJson } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { estimateTokens } from '../../shared/tokens.ts';
import { type Row, num, str } from './rows.ts';
import type { Character } from '../../shared/types.ts';

function toCharacter(row: Row): Character {
  return {
    id: str(row.id),
    storyId: str(row.story_id),
    name: str(row.name),
    tagline: str(row.tagline),
    description: str(row.description),
    personality: str(row.personality),
    speech: str(row.speech),
    scenario: str(row.scenario),
    exampleDialogue: str(row.example_dialogue),
    meta: parseJson<Record<string, unknown>>(row.meta, {}),
    avatar: row.avatar === null ? null : str(row.avatar),
    tokens: num(row.tokens),
    order: num(row.sort_order),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

/* --------------------------------------------------------------- characters */

export const characters = {
  list(storyId: string): Character[] {
    const rows = getDb()
      .prepare('SELECT * FROM characters WHERE story_id = ? ORDER BY sort_order, created_at')
      .all(storyId) as Row[];
    return rows.map(toCharacter);
  },

  get(id: string): Character | null {
    const row = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row | undefined;
    return row ? toCharacter(row) : null;
  },

  /** Token counts are derived, so they are always recomputed on write. */
  create(storyId: string, init: Partial<Character> = {}): Character {
    const now = Date.now();
    const orderRow = getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM characters WHERE story_id = ?')
      .get(storyId) as Row | undefined;

    const character: Character = {
      id: newId(),
      storyId,
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
      order: init.order ?? num(orderRow?.m, -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    character.tokens = characterCardTokens(character);

    getDb()
      .prepare(
        `INSERT INTO characters (
           id, story_id, name, tagline, description, personality, speech, scenario,
           example_dialogue, meta, avatar, tokens, sort_order, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        character.id, character.storyId, character.name, character.tagline, character.description,
        character.personality, character.speech, character.scenario, character.exampleDialogue,
        JSON.stringify(character.meta), character.avatar, character.tokens, character.order,
        character.createdAt, character.updatedAt,
      );

    return character;
  },

  update(id: string, patch: Partial<Character>): Character | null {
    const existing = characters.get(id);
    if (!existing) return null;
    const merged: Character = { ...existing, ...patch, id, updatedAt: Date.now() };
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

    return merged;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM characters WHERE id = ?').run(id);
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
