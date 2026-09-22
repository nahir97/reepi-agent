/**
 * Prompt templates persistence.
 *
 * Rows here are the writer's own templates. The code-shipped starters live in
 * `src/server/templates.ts` and are merged into the list at the route, because a
 * constant can be corrected in a release while a seeded row cannot.
 *
 * The row mapper and the DAO live in the same file on purpose: a schema change
 * and the code that reads it are then one edit, not two files that can drift.
 * `blocks` is JSON, and it is narrowed on the way out — a hand-edited blob must
 * not be able to put text into a block that is not editable.
 */

import { getDb, parseJson } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { isEditableBlock } from '../../shared/types.ts';
import { type Row, num, str } from './rows.ts';
import type { EditableBlock, PromptTemplate } from '../../shared/types.ts';

/** Keys that are not editable blocks, or values that are not text, are dropped. */
function toBlocks(raw: unknown): Partial<Record<EditableBlock, string>> {
  const parsed = parseJson<Record<string, unknown>>(raw, {});
  const blocks: Partial<Record<EditableBlock, string>> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isEditableBlock(key)) continue;
    if (typeof value !== 'string' || !value.trim()) continue;
    blocks[key] = value;
  }
  return blocks;
}

function toPromptTemplate(row: Row): PromptTemplate {
  return {
    id: str(row.id),
    name: str(row.name),
    blurb: str(row.blurb),
    blocks: toBlocks(row.blocks),
    builtin: false,
    sortOrder: num(row.sort_order),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

/* -------------------------------------------------------- prompt templates */

export const templates = {
  list(): PromptTemplate[] {
    const rows = getDb()
      .prepare('SELECT * FROM prompt_templates ORDER BY sort_order, created_at')
      .all() as Row[];
    return rows.map(toPromptTemplate);
  },

  get(id: string): PromptTemplate | null {
    const row = getDb().prepare('SELECT * FROM prompt_templates WHERE id = ?').get(id) as Row | undefined;
    return row ? toPromptTemplate(row) : null;
  },

  create(init: Partial<PromptTemplate> = {}): PromptTemplate {
    const now = Date.now();
    const last = getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM prompt_templates')
      .get() as Row | undefined;

    const template: PromptTemplate = {
      id: newId(),
      name: init.name ?? 'Untitled template',
      blurb: init.blurb ?? '',
      blocks: toBlocks(JSON.stringify(init.blocks ?? {})),
      builtin: false,
      sortOrder: init.sortOrder ?? num(last?.m, -1) + 1,
      createdAt: now,
      updatedAt: now,
    };

    getDb()
      .prepare(
        `INSERT INTO prompt_templates (id, name, blurb, blocks, sort_order, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        template.id,
        template.name,
        template.blurb,
        JSON.stringify(template.blocks),
        template.sortOrder,
        template.createdAt,
        template.updatedAt,
      );

    return template;
  },

  update(id: string, patch: Partial<PromptTemplate>): PromptTemplate | null {
    const existing = templates.get(id);
    if (!existing) return null;
    const merged: PromptTemplate = {
      ...existing,
      ...patch,
      id,
      builtin: false,
      blocks: toBlocks(JSON.stringify(patch.blocks ?? existing.blocks)),
      updatedAt: Date.now(),
    };

    getDb()
      .prepare(
        'UPDATE prompt_templates SET name=?, blurb=?, blocks=?, sort_order=?, updated_at=? WHERE id=?',
      )
      .run(
        merged.name,
        merged.blurb,
        JSON.stringify(merged.blocks),
        merged.sortOrder,
        merged.updatedAt,
        id,
      );

    return merged;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM prompt_templates WHERE id = ?').run(id);
  },
};
