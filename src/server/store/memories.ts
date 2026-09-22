/**
 * Memories persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { type Row, num, str } from './rows.ts';
import type { Memory } from '../../shared/types.ts';

function toMemory(row: Row): Memory {
  return {
    id: str(row.id),
    storyId: str(row.story_id),
    text: str(row.text),
    subject: str(row.subject),
    sourceMessageId: row.source_message_id === null ? null : str(row.source_message_id),
    seq: num(row.seq),
    salience: num(row.salience, 0.5),
    kind: str(row.kind, 'fact') as Memory['kind'],
    createdAt: num(row.created_at),
  };
}

/* ----------------------------------------------------------------- memories */

export const memories = {
  list(storyId: string, limit = 500): Memory[] {
    const rows = getDb()
      .prepare('SELECT * FROM memories WHERE story_id = ? ORDER BY seq DESC LIMIT ?')
      .all(storyId, limit) as Row[];
    return rows.map(toMemory);
  },

  add(init: Omit<Memory, 'id' | 'createdAt'>): Memory {
    const memory: Memory = { ...init, id: newId(), createdAt: Date.now() };
    getDb()
      .prepare(
        `INSERT INTO memories (id, story_id, text, subject, source_message_id, seq, salience, kind, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        memory.id, memory.storyId, memory.text, memory.subject, memory.sourceMessageId,
        memory.seq, memory.salience, memory.kind, memory.createdAt,
      );
    getDb()
      .prepare('INSERT INTO memories_fts (rowid, text, subject) VALUES (?,?,?)')
      .run(
        (getDb()
          .prepare('SELECT rowid FROM memories WHERE id = ?')
          .get(memory.id) as Row).rowid as number,
        memory.text,
        memory.subject,
      );
    return memory;
  },

  /**
   * Local BM25 recall. Runs in-process against the FTS5 index: zero API cost,
   * zero latency, and it is the *default* recall path — API-based embedding
   * recall is an opt-in upgrade rather than a prerequisite.
   *
   * The query is built by OR-ing the longest terms from the recent transcript;
   * FTS5 ranks with BM25 and we blend in recency bias and stored salience.
   */
  recall(storyId: string, terms: string[], limit = 8): { memory: Memory; score: number }[] {
    const unique = [...new Set(terms.map((term) => term.toLowerCase()).filter((t) => t.length >= 4))];
    if (unique.length === 0) return [];

    const match = unique
      .slice(0, 18)
      .map((term) => `"${term.replace(/"/g, '')}"`)
      .join(' OR ');

    let rows: Row[] = [];
    try {
      rows = getDb()
        .prepare(
          `SELECT m.*, bm25(memories_fts, 1.0, 0.4) AS rank
             FROM memories_fts
             JOIN memories m ON m.rowid = memories_fts.rowid
            WHERE memories_fts MATCH ? AND m.story_id = ?
            ORDER BY rank
            LIMIT ?`,
        )
        .all(match, storyId, limit * 3) as Row[];
    } catch {
      return []; // A malformed MATCH must never break a turn.
    }

    if (rows.length === 0) return [];
    const maxSeq = Math.max(...rows.map((row) => num(row.seq)));

    return rows
      .map((row) => {
        const memory = toMemory(row);
        // bm25() returns negative numbers, more negative == better.
        const relevance = -num(row.rank, 0);
        const recency = maxSeq > 0 ? memory.seq / maxSeq : 0;
        return { memory, score: relevance * 1.6 + recency * 0.5 + memory.salience * 0.4 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },

  remove(id: string): void {
    const row = getDb().prepare('SELECT rowid FROM memories WHERE id = ?').get(id) as Row | undefined;
    if (row) getDb().prepare('DELETE FROM memories_fts WHERE rowid = ?').run(row.rowid as number);
    getDb().prepare('DELETE FROM memories WHERE id = ?').run(id);
  },

  removeForStory(storyId: string): void {
    const rows = getDb().prepare('SELECT rowid FROM memories WHERE story_id = ?').all(storyId) as Row[];
    const statement = getDb().prepare('DELETE FROM memories_fts WHERE rowid = ?');
    for (const row of rows) statement.run(row.rowid as number);
    getDb().prepare('DELETE FROM memories WHERE story_id = ?').run(storyId);
  },

  count(storyId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS n FROM memories WHERE story_id = ?')
      .get(storyId) as Row | undefined;
    return num(row?.n);
  },
};
