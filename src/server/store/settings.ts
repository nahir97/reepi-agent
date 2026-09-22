/**
 * Settings persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb, parseJson } from '../db.ts';
import { type Row, str } from './rows.ts';



/* ----------------------------------------------------------------- settings */

export const settings = {
  get<T>(key: string, fallback: T): T {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    if (!row) return fallback;
    return parseJson<T>(row.value, fallback);
  },

  set(key: string, value: unknown): void {
    getDb()
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, JSON.stringify(value));
  },

  all(): Record<string, unknown> {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as Row[];
    const out: Record<string, unknown> = {};
    for (const row of rows) out[str(row.key)] = parseJson<unknown>(row.value, null);
    return out;
  },
};
