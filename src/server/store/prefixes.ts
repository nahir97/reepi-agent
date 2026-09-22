/**
 * Prefixes persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb, parseJson } from '../db.ts';
import { type Row, num, str } from './rows.ts';



/* ----------------------------------------------------------------- prefixes */

export type PrefixRecord = {
  fingerprint: string;
  storyId: string;
  tokens: number;
  blockHashes: Record<string, string>;
  blockTokens: Record<string, number>;
  /**
   * Per-message (content hash, token cost, character length), in order. The
   * character length lets the next turn verify that a grown transcript still
   * starts with the previous turn's exact content, with no text stored.
   */
  messageMeta: { hash: string; tokens: number; chars: number }[];
  createdAt: number;
};

export const prefixes = {
  latest(storyId: string): PrefixRecord | null {
    const row = getDb()
      .prepare('SELECT * FROM prefixes WHERE story_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(storyId) as Row | undefined;
    if (!row) return null;
    return {
      fingerprint: str(row.fingerprint),
      storyId: str(row.story_id),
      tokens: num(row.tokens),
      blockHashes: parseJson<Record<string, string>>(row.block_hashes, {}),
      blockTokens: parseJson<Record<string, number>>(row.block_tokens, {}),
      messageMeta: parseJson<{ hash: string; tokens: number; chars: number }[]>(row.message_hashes, []),
      createdAt: num(row.created_at),
    };
  },

  save(record: Omit<PrefixRecord, 'createdAt'>): void {
    getDb()
      .prepare(
        `INSERT INTO prefixes (
           fingerprint, story_id, tokens, block_hashes, block_tokens, message_hashes, created_at
         ) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(fingerprint) DO UPDATE SET
           tokens = excluded.tokens,
           block_hashes = excluded.block_hashes,
           block_tokens = excluded.block_tokens,
           message_hashes = excluded.message_hashes,
           created_at = excluded.created_at`,
      )
      .run(
        record.fingerprint, record.storyId, record.tokens,
        JSON.stringify(record.blockHashes), JSON.stringify(record.blockTokens),
        JSON.stringify(record.messageMeta), Date.now(),
      );
  },

  /** Keep only the newest few fingerprints per story; older ones never match again. */
  prune(storyId: string, keep = 24): void {
    getDb()
      .prepare(
        `DELETE FROM prefixes WHERE story_id = ? AND fingerprint NOT IN (
           SELECT fingerprint FROM prefixes WHERE story_id = ? ORDER BY created_at DESC LIMIT ?
         )`,
      )
      .run(storyId, storyId, keep);
  },
};
