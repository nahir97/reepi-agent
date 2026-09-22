/**
 * Ledger persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb, intToBool, boolToInt } from '../db.ts';
import { type Row, num, str } from './rows.ts';
import type { CostEvent, CostEventKind, ModelId } from '../../shared/types.ts';

function toCostEvent(row: Row): CostEvent {
  return {
    id: num(row.id),
    storyId: row.story_id === null ? null : str(row.story_id),
    kind: str(row.kind, 'narration') as CostEventKind,
    model: str(row.model, 'deepseek-flash') as ModelId,
    cacheHitTokens: num(row.cache_hit_tokens),
    cacheMissTokens: num(row.cache_miss_tokens),
    outputTokens: num(row.output_tokens),
    reasoningTokens: num(row.reasoning_tokens),
    costUsd: num(row.cost_usd),
    savedUsd: num(row.saved_usd),
    peak: intToBool(row.peak),
    createdAt: num(row.created_at),
  };
}

/* -------------------------------------------------------------- cost ledger */

export const ledger = {
  record(init: Omit<CostEvent, 'id' | 'createdAt'>): void {
    getDb()
      .prepare(
        `INSERT INTO cost_events (
           story_id, kind, model, cache_hit_tokens, cache_miss_tokens, output_tokens,
           reasoning_tokens, cost_usd, saved_usd, peak, created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        init.storyId, init.kind, init.model, init.cacheHitTokens, init.cacheMissTokens,
        init.outputTokens, init.reasoningTokens, init.costUsd, init.savedUsd, boolToInt(init.peak),
        Date.now(),
      );
  },

  forStory(storyId: string, limit = 200): CostEvent[] {
    const rows = getDb()
      .prepare('SELECT * FROM cost_events WHERE story_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(storyId, limit) as Row[];
    return rows.map(toCostEvent);
  },

  recent(limit = 200): CostEvent[] {
    const rows = getDb()
      .prepare('SELECT * FROM cost_events ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Row[];
    return rows.map(toCostEvent);
  },

  summary(storyId: string | null, since: number): CostEvent[] {
    const sql = storyId
      ? 'SELECT * FROM cost_events WHERE story_id = ? AND created_at >= ? ORDER BY created_at'
      : 'SELECT * FROM cost_events WHERE created_at >= ? ORDER BY created_at';
    const params = storyId ? [storyId, since] : [since];
    return (getDb().prepare(sql).all(...params) as Row[]).map(toCostEvent);
  },
};
