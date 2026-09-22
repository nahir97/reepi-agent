/**
 * Warmups persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb } from '../db.ts';
import { hashContent } from '../../shared/ids.ts';
import { type Row, num, str } from './rows.ts';



/* ------------------------------------------------------------------ warmups */

export type Warmup = { storyId: string; fingerprint: string; warmedAt: number; tokens: number; costUsd: number };

export const warmups = {
  get(storyId: string): Warmup | null {
    const row = getDb().prepare('SELECT * FROM warmups WHERE story_id = ?').get(storyId) as Row | undefined;
    if (!row) return null;
    return {
      storyId: str(row.story_id),
      fingerprint: str(row.fingerprint),
      warmedAt: num(row.warmed_at),
      tokens: num(row.tokens),
      costUsd: num(row.cost_usd),
    };
  },

  save(record: Warmup): void {
    getDb()
      .prepare(
        `INSERT INTO warmups (story_id, fingerprint, warmed_at, tokens, cost_usd)
         VALUES (?,?,?,?,?)
         ON CONFLICT(story_id) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           warmed_at = excluded.warmed_at,
           tokens = excluded.tokens,
           cost_usd = excluded.cost_usd`,
      )
      .run(record.storyId, record.fingerprint, record.warmedAt, record.tokens, record.costUsd);
  },
};

