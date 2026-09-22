/**
 * Notes persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb, intToBool, boolToInt, parseJson } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { type Row, num, str } from './rows.ts';
import type { DirectorNote } from '../../shared/types.ts';

function toNote(row: Row): DirectorNote {
  return {
    id: str(row.id),
    storyId: str(row.story_id),
    messageId: row.message_id === null ? null : str(row.message_id),
    kind: str(row.kind, 'observe') as DirectorNote['kind'],
    body: str(row.body),
    payload: parseJson<Record<string, unknown> | null>(row.payload, null),
    accepted: intToBool(row.accepted),
    createdAt: num(row.created_at),
  };
}

/* -------------------------------------------------------------------- notes */

export const notes = {
  list(storyId: string, limit = 60): DirectorNote[] {
    const rows = getDb()
      .prepare('SELECT * FROM notes WHERE story_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(storyId, limit) as Row[];
    return rows.map(toNote);
  },

  add(init: Omit<DirectorNote, 'id' | 'createdAt'>): DirectorNote {
    const note: DirectorNote = { ...init, id: newId(), createdAt: Date.now() };
    getDb()
      .prepare(
        `INSERT INTO notes (id, story_id, message_id, kind, body, payload, accepted, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        note.id, note.storyId, note.messageId, note.kind, note.body,
        note.payload ? JSON.stringify(note.payload) : null, boolToInt(note.accepted), note.createdAt,
      );
    return note;
  },

  setAccepted(id: string, accepted: boolean): void {
    getDb().prepare('UPDATE notes SET accepted = ? WHERE id = ?').run(boolToInt(accepted), id);
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
  },
};
