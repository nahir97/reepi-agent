/**
 * Messages persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb, intToBool, boolToInt, parseJson } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { countWords } from '../../shared/tokens.ts';
import { type Row, num, str } from './rows.ts';
import type { LoreHit, Message, MessageOrigin, MessageUsage, Role } from '../../shared/types.ts';

function toMessage(row: Row): Message {
  return {
    id: str(row.id),
    storyId: str(row.story_id),
    sceneId: str(row.scene_id),
    role: str(row.role, 'user') as Role,
    variants: parseJson<string[]>(row.variants, []),
    activeVariant: num(row.active_variant),
    reasoning: parseJson<string[]>(row.reasoning, []),
    origin: str(row.origin, 'user') as MessageOrigin,
    speaker: row.speaker === null ? null : str(row.speaker),
    injections: parseJson<LoreHit[]>(row.injections, []),
    usage: parseJson<MessageUsage | null>(row.usage, null),
    pinned: intToBool(row.pinned),
    disabled: intToBool(row.disabled),
    seq: num(row.seq),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

/* ----------------------------------------------------------------- messages */

/** Next position in a story's transcript. Sequences are per-story, not global. */
function nextSeq(storyId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE story_id = ?')
    .get(storyId) as Row | undefined;
  return num(row?.seq) + 1;
}

export const messages = {
  list(storyId: string, sceneId?: string): Message[] {
    const sql = sceneId
      ? 'SELECT * FROM messages WHERE story_id = ? AND scene_id = ? ORDER BY seq'
      : 'SELECT * FROM messages WHERE story_id = ? ORDER BY seq';
    const params = sceneId ? [storyId, sceneId] : [storyId];
    return (getDb().prepare(sql).all(...params) as Row[]).map(toMessage);
  },

  get(id: string): Message | null {
    const row = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined;
    return row ? toMessage(row) : null;
  },

  create(init: {
    storyId: string;
    sceneId: string;
    role: Role;
    variants: string[];
    reasoning?: string[];
    origin?: MessageOrigin;
    speaker?: string | null;
    injections?: LoreHit[];
    usage?: MessageUsage | null;
    seq?: number;
  }): Message {
    const now = Date.now();
    const seq = init.seq ?? nextSeq(init.storyId);
    const message: Message = {
      id: newId(),
      storyId: init.storyId,
      sceneId: init.sceneId,
      role: init.role,
      variants: init.variants,
      activeVariant: Math.max(0, init.variants.length - 1),
      reasoning: init.reasoning ?? [],
      origin: init.origin ?? 'user',
      speaker: init.speaker ?? null,
      injections: init.injections ?? [],
      usage: init.usage ?? null,
      pinned: false,
      disabled: false,
      seq,
      createdAt: now,
      updatedAt: now,
    };

    getDb()
      .prepare(
        `INSERT INTO messages (
           id, story_id, scene_id, role, variants, active_variant, reasoning, origin, speaker,
           injections, usage, pinned, disabled, seq, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        message.id, message.storyId, message.sceneId, message.role, JSON.stringify(message.variants),
        message.activeVariant, JSON.stringify(message.reasoning), message.origin, message.speaker,
        JSON.stringify(message.injections), message.usage ? JSON.stringify(message.usage) : null,
        boolToInt(message.pinned), boolToInt(message.disabled),
        seq, message.createdAt, message.updatedAt,
      );

    return message;
  },

  update(id: string, patch: Partial<Message>): Message | null {
    const existing = messages.get(id);
    if (!existing) return null;
    const merged: Message = { ...existing, ...patch, id, updatedAt: Date.now() };
    // A variant can only be selected if it exists.
    merged.activeVariant = Math.min(
      Math.max(0, merged.activeVariant),
      Math.max(0, merged.variants.length - 1),
    );

    getDb()
      .prepare(
        `UPDATE messages SET
           variants=?, active_variant=?, reasoning=?, origin=?, speaker=?, injections=?,
           usage=?, pinned=?, disabled=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        JSON.stringify(merged.variants), merged.activeVariant, JSON.stringify(merged.reasoning),
        merged.origin, merged.speaker, JSON.stringify(merged.injections),
        merged.usage ? JSON.stringify(merged.usage) : null, boolToInt(merged.pinned),
        boolToInt(merged.disabled), merged.updatedAt, id,
      );

    return merged;
  },

  /** Replace the active variant's text, keeping siblings intact. */
  setVariantText(id: string, index: number, text: string): Message | null {
    const message = messages.get(id);
    if (!message || index < 0 || index >= message.variants.length) return null;
    const variants = [...message.variants];
    variants[index] = text;
    return messages.update(id, { variants });
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM messages WHERE id = ?').run(id);
  },

  removeAfter(storyId: string, seq: number): void {
    getDb().prepare('DELETE FROM messages WHERE story_id = ? AND seq > ?').run(storyId, seq);
  },

  /** Everything from `seq` onward — the tail that a branch copies. */
  fromSeq(storyId: string, seq: number): Message[] {
    const rows = getDb()
      .prepare('SELECT * FROM messages WHERE story_id = ? AND seq >= ? ORDER BY seq')
      .all(storyId, seq) as Row[];
    return rows.map(toMessage);
  },

  count(storyId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE story_id = ?')
      .get(storyId) as Row | undefined;
    return num(row?.n);
  },

  /** Words the assistant has produced for a story, for the writing stats panel. */
  assistantWords(storyId: string): number {
    const rows = getDb()
      .prepare("SELECT variants, active_variant FROM messages WHERE story_id = ? AND role = 'assistant'")
      .all(storyId) as Row[];
    let words = 0;
    for (const row of rows) {
      const variants = parseJson<string[]>(row.variants, []);
      words += countWords(variants[num(row.active_variant)] ?? '');
    }
    return words;
  },
};
