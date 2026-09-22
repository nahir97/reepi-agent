/**
 * The creation assistant's conversation.
 *
 * One table, app-scoped, no foreign keys — because this is a *record*, not a
 * story. Nothing here is ever read by the composer: the assistant's chat is not a
 * transcript, and the only thing that crosses from it into the rest of the app is
 * the rows its tools wrote.
 *
 * An assistant row stores its receipt as JSON. That is what makes a reload show
 * the same receipt the writer saw when it happened, and it is why the page does
 * not need to reconstruct what a turn did from the current state — which would
 * have been a lie the moment anyone edited a card afterwards.
 *
 * The row mapper and the DAO live together, like every other store module, so a
 * schema change and the code that reads it are one edit.
 */

import { getDb, boolToInt, intToBool, parseJson } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { type Row, num, str } from './rows.ts';
import type { CreatorMessage, CreatorRole } from '../../shared/types.ts';

function toCreatorMessage(row: Row): CreatorMessage {
  return {
    id: str(row.id),
    role: str(row.role, 'user') as CreatorRole,
    body: str(row.body),
    receipt: parseJson<CreatorMessage['receipt']>(row.receipt, null),
    allowOverwrite: intToBool(row.allow_overwrite),
    targetStoryId:
      row.target_story_id === null || row.target_story_id === undefined ? null : str(row.target_story_id),
    at: num(row.created_at),
  };
}

/** How many turns the reader keeps by default — enough to scroll, bounded to fetch. */
const DEFAULT_LIMIT = 200;

export const creator = {
  /**
   * The conversation, oldest first.
   *
   * Read newest-first and reversed, so the cap keeps the *recent* turns rather
   * than the first ones. `rowid` breaks the created_at tie a turn's two rows can
   * share, which is what keeps an ask and its answer in the order they happened.
   */
  list(limit: number = DEFAULT_LIMIT): CreatorMessage[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM creator_messages ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.trunc(limit))) as Row[];
    return rows.reverse().map(toCreatorMessage);
  },

  count(): number {
    const row = getDb().prepare('SELECT COUNT(*) AS n FROM creator_messages').get() as Row | undefined;
    return num(row?.n);
  },

  add(init: {
    role: CreatorRole;
    body: string;
    receipt?: CreatorMessage['receipt'];
    allowOverwrite?: boolean;
    targetStoryId?: string | null;
  }): CreatorMessage {
    const message: CreatorMessage = {
      id: newId(),
      role: init.role,
      body: init.body,
      receipt: init.receipt ?? null,
      allowOverwrite: init.allowOverwrite ?? false,
      targetStoryId: init.targetStoryId ?? null,
      at: Date.now(),
    };

    getDb()
      .prepare(
        `INSERT INTO creator_messages (id, role, body, receipt, allow_overwrite, target_story_id, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        message.id,
        message.role,
        message.body,
        message.receipt ? JSON.stringify(message.receipt) : null,
        boolToInt(message.allowOverwrite),
        message.targetStoryId,
        message.at,
      );

    return message;
  },

  /** "New chat": the conversation goes, everything it wrote stays. */
  clear(): void {
    getDb().prepare('DELETE FROM creator_messages').run();
  },
};
