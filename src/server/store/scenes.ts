/**
 * Scenes persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb, intToBool, boolToInt, parseJson } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { type Row, num, str } from './rows.ts';
import type { Scene, SceneStateField } from '../../shared/types.ts';

function toScene(row: Row): Scene {
  return {
    id: str(row.id),
    storyId: str(row.story_id),
    title: str(row.title),
    state: parseJson<SceneStateField[]>(row.state, []),
    notes: str(row.notes),
    order: num(row.sort_order),
    archived: intToBool(row.archived),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

/* ------------------------------------------------------------------- scenes */

export const scenes = {
  list(storyId: string, includeArchived = false): Scene[] {
    const sql = includeArchived
      ? 'SELECT * FROM scenes WHERE story_id = ? ORDER BY sort_order, created_at'
      : 'SELECT * FROM scenes WHERE story_id = ? AND archived = 0 ORDER BY sort_order, created_at';
    return (getDb().prepare(sql).all(storyId) as Row[]).map(toScene);
  },

  get(id: string): Scene | null {
    const row = getDb().prepare('SELECT * FROM scenes WHERE id = ?').get(id) as Row | undefined;
    return row ? toScene(row) : null;
  },

  create(storyId: string, init: Partial<Scene> = {}): Scene {
    const now = Date.now();
    const orderRow = getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM scenes WHERE story_id = ?')
      .get(storyId) as Row | undefined;

    const scene: Scene = {
      id: newId(),
      storyId,
      title: init.title ?? 'Opening',
      state: init.state ?? [],
      notes: init.notes ?? '',
      order: init.order ?? num(orderRow?.m, -1) + 1,
      archived: init.archived ?? false,
      createdAt: now,
      updatedAt: now,
    };

    getDb()
      .prepare(
        `INSERT INTO scenes (id, story_id, title, state, notes, sort_order, archived, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        scene.id, scene.storyId, scene.title, JSON.stringify(scene.state), scene.notes,
        scene.order, boolToInt(scene.archived), scene.createdAt, scene.updatedAt,
      );

    return scene;
  },

  update(id: string, patch: Partial<Scene>): Scene | null {
    const existing = scenes.get(id);
    if (!existing) return null;
    const merged: Scene = { ...existing, ...patch, id, updatedAt: Date.now() };

    getDb()
      .prepare(
        `UPDATE scenes SET title=?, state=?, notes=?, sort_order=?, archived=?, updated_at=? WHERE id=?`,
      )
      .run(
        merged.title, JSON.stringify(merged.state), merged.notes, merged.order,
        boolToInt(merged.archived), merged.updatedAt, id,
      );

    return merged;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM scenes WHERE id = ?').run(id);
  },

  setState(id: string, key: string, value: string): Scene | null {
    const scene = scenes.get(id);
    if (!scene) return null;
    const state = [...scene.state];
    const index = state.findIndex((field) => field.key === key);
    if (value.trim() === '') {
      if (index !== -1) state.splice(index, 1);
    } else if (index === -1) {
      state.push({ key, value });
    } else {
      state[index] = { key, value };
    }
    return scenes.update(id, { state });
  },
};
