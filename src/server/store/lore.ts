/**
 * Lore persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb, intToBool, boolToInt } from '../db.ts';
import { newId, parseKeys, serialiseKeys } from '../../shared/ids.ts';
import { estimateTokens } from '../../shared/tokens.ts';
import { type Row, num, str } from './rows.ts';
import type { LoreEntry, LorePosition } from '../../shared/types.ts';

function toLore(row: Row): LoreEntry {
  return {
    id: str(row.id),
    storyId: str(row.story_id),
    title: str(row.title),
    body: str(row.body),
    keys: str(row.keys),
    position: str(row.position, 'anchor') as LorePosition,
    depth: num(row.depth, 4),
    priority: num(row.priority, 100),
    weight: num(row.weight, 1),
    constant: intToBool(row.constant),
    enabled: intToBool(row.enabled),
    tokens: num(row.tokens),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

/* --------------------------------------------------------------------- lore */

export const lore = {
  list(storyId: string): LoreEntry[] {
    const rows = getDb()
      .prepare('SELECT * FROM lore WHERE story_id = ? ORDER BY position, priority, created_at')
      .all(storyId) as Row[];
    return rows.map(toLore);
  },

  get(id: string): LoreEntry | null {
    const row = getDb().prepare('SELECT * FROM lore WHERE id = ?').get(id) as Row | undefined;
    return row ? toLore(row) : null;
  },

  create(storyId: string, init: Partial<LoreEntry> = {}): LoreEntry {
    const now = Date.now();
    const entry: LoreEntry = {
      id: newId(),
      storyId,
      title: init.title ?? 'New Entry',
      body: init.body ?? '',
      keys: serialiseKeys(parseKeys(init.keys ?? '')),
      position: init.position ?? 'anchor',
      depth: init.depth ?? 4,
      priority: init.priority ?? 100,
      weight: init.weight ?? 1,
      constant: init.constant ?? false,
      enabled: init.enabled ?? true,
      tokens: estimateTokens(`${init.title ?? ''}\n${init.body ?? ''}`),
      createdAt: now,
      updatedAt: now,
    };

    getDb()
      .prepare(
        `INSERT INTO lore (
           id, story_id, title, body, keys, position, depth, priority, weight,
           constant, enabled, tokens, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        entry.id, entry.storyId, entry.title, entry.body, entry.keys, entry.position, entry.depth,
        entry.priority, entry.weight, boolToInt(entry.constant), boolToInt(entry.enabled),
        entry.tokens, entry.createdAt, entry.updatedAt,
      );

    return entry;
  },

  update(id: string, patch: Partial<LoreEntry>): LoreEntry | null {
    const existing = lore.get(id);
    if (!existing) return null;
    const merged: LoreEntry = { ...existing, ...patch, id, updatedAt: Date.now() };
    if (patch.keys !== undefined) merged.keys = serialiseKeys(parseKeys(merged.keys));
    merged.tokens = estimateTokens(`${merged.title}\n${merged.body}`);

    getDb()
      .prepare(
        `UPDATE lore SET
           title=?, body=?, keys=?, position=?, depth=?, priority=?, weight=?,
           constant=?, enabled=?, tokens=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        merged.title, merged.body, merged.keys, merged.position, merged.depth, merged.priority,
        merged.weight, boolToInt(merged.constant), boolToInt(merged.enabled), merged.tokens,
        merged.updatedAt, id,
      );

    return merged;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM lore WHERE id = ?').run(id);
  },
};
