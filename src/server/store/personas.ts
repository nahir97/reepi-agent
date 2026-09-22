/**
 * Personas persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb, intToBool, boolToInt } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { estimateTokens } from '../../shared/tokens.ts';
import { type Row, num, str } from './rows.ts';
import type { Persona } from '../../shared/types.ts';

function toPersona(row: Row): Persona {
  return {
    id: str(row.id),
    storyId: str(row.story_id),
    name: str(row.name),
    description: str(row.description),
    avatar: row.avatar === null || row.avatar === undefined ? null : str(row.avatar),
    tokens: num(row.tokens),
    isDefault: intToBool(row.is_default),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

/* ----------------------------------------------------------------- personas */

export const personas = {
  list(storyId: string): Persona[] {
    const rows = getDb()
      .prepare('SELECT * FROM personas WHERE story_id = ? ORDER BY created_at')
      .all(storyId) as Row[];
    return rows.map(toPersona);
  },

  get(id: string): Persona | null {
    const row = getDb().prepare('SELECT * FROM personas WHERE id = ?').get(id) as Row | undefined;
    return row ? toPersona(row) : null;
  },

  create(storyId: string, init: Partial<Persona> = {}): Persona {
    const now = Date.now();
    const persona: Persona = {
      id: newId(),
      storyId,
      name: init.name ?? 'You',
      description: init.description ?? '',
      avatar: init.avatar ?? null,
      tokens: estimateTokens(init.description ?? ''),
      isDefault: init.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };

    if (persona.isDefault) {
      getDb().prepare('UPDATE personas SET is_default = 0 WHERE story_id = ?').run(storyId);
    }

    getDb()
      .prepare(
        `INSERT INTO personas (id, story_id, name, description, avatar, tokens, is_default, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        persona.id, persona.storyId, persona.name, persona.description, persona.avatar, persona.tokens,
        boolToInt(persona.isDefault), persona.createdAt, persona.updatedAt,
      );

    return persona;
  },

  update(id: string, patch: Partial<Persona>): Persona | null {
    const existing = personas.get(id);
    if (!existing) return null;
    const merged: Persona = { ...existing, ...patch, id, updatedAt: Date.now() };
    merged.tokens = estimateTokens(merged.description);

    if (merged.isDefault) {
      getDb().prepare('UPDATE personas SET is_default = 0 WHERE story_id = ?').run(merged.storyId);
    }

    getDb()
      .prepare(
        `UPDATE personas SET name=?, description=?, avatar=?, tokens=?, is_default=?, updated_at=? WHERE id=?`,
      )
      .run(
        merged.name, merged.description, merged.avatar, merged.tokens, boolToInt(merged.isDefault),
        merged.updatedAt, id,
      );

    return merged;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM personas WHERE id = ?').run(id);
  },
};
