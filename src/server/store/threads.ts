/**
 * Threads persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { type Row, num, str } from './rows.ts';
import type { Thread } from '../../shared/types.ts';

function toThread(row: Row): Thread {
  return {
    id: str(row.id),
    storyId: str(row.story_id),
    sceneId: row.scene_id === null ? null : str(row.scene_id),
    label: str(row.label),
    status: str(row.status, 'open') as Thread['status'],
    openedAt: row.opened_at === null ? null : str(row.opened_at),
    resolvedAt: row.resolved_at === null ? null : str(row.resolved_at),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

/* ------------------------------------------------------------------ threads */

export const threads = {
  list(storyId: string): Thread[] {
    const rows = getDb()
      .prepare('SELECT * FROM threads WHERE story_id = ? ORDER BY status, created_at')
      .all(storyId) as Row[];
    return rows.map(toThread);
  },

  upsertOpen(storyId: string, label: string, sceneId: string | null): Thread {
    const existing = getDb()
      .prepare('SELECT * FROM threads WHERE story_id = ? AND label = ? AND status = ? LIMIT 1')
      .get(storyId, label, 'open') as Row | undefined;
    if (existing) return toThread(existing);

    const now = Date.now();
    const thread: Thread = {
      id: newId(),
      storyId,
      sceneId,
      label,
      status: 'open',
      openedAt: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    getDb()
      .prepare(
        `INSERT INTO threads (id, story_id, scene_id, label, status, opened_at, resolved_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(thread.id, thread.storyId, thread.sceneId, thread.label, thread.status, null, null, now, now);
    return thread;
  },

  close(storyId: string, label: string): void {
    getDb()
      .prepare("UPDATE threads SET status = 'closed', resolved_at = ?, updated_at = ? WHERE story_id = ? AND label = ? AND status = 'open'")
      .run(new Date().toISOString(), Date.now(), storyId, label);
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM threads WHERE id = ?').run(id);
  },
};
