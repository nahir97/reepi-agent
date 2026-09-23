/**
 * Stories persistence.
 *
 * Split out of the former monolithic store.ts. The row mapper and the DAO live in
 * the same file on purpose: a schema change and the code that reads it are then one
 * edit, not two files that can drift apart.
 */

import { getDb } from '../db.ts';
import { newId } from '../../shared/ids.ts';
import { type Row, num, str } from './rows.ts';
import type { ModelId, ReasoningEffort, Story, Theme } from '../../shared/types.ts';

function toStory(row: Row): Story {
  return {
    id: str(row.id),
    title: str(row.title),
    genre: str(row.genre),
    scenario: str(row.scenario),
    bible: str(row.bible),
    style: str(row.style),
    exemplars: str(row.exemplars),
    instruct: str(row.instruct),
    personaId: row.persona_id === null ? null : str(row.persona_id),
    characterId: row.character_id === null || row.character_id === undefined ? null : str(row.character_id),
    templateId: row.template_id === null || row.template_id === undefined ? null : str(row.template_id),
    model: str(row.model, 'deepseek-flash') as ModelId,
    effort: str(row.effort, 'none') as ReasoningEffort,
    temperature: num(row.temperature, 1),
    topP: num(row.top_p, 0.98),
    maxTokens: num(row.max_tokens, 900),
    targetWords: num(row.target_words, 300),
    contract: str(row.contract),
    loreBudget: num(row.lore_budget, 2000),
    historyBudget: num(row.history_budget, 32000),
    prefill: str(row.prefill),
    theme: str(row.theme, 'ink') as Theme,
    cover: row.cover === null ? null : str(row.cover),
    synopsis: str(row.synopsis),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

/* ------------------------------------------------------------------ stories */


export const stories = {
  list(): Story[] {
    const rows = getDb()
      .prepare('SELECT * FROM stories ORDER BY updated_at DESC')
      .all() as Row[];
    return rows.map(toStory);
  },

  get(id: string): Story | null {
    const row = getDb().prepare('SELECT * FROM stories WHERE id = ?').get(id) as Row | undefined;
    return row ? toStory(row) : null;
  },

  create(init: Partial<Story> = {}): Story {
    const now = Date.now();
    const story: Story = {
      id: newId(),
      title: init.title ?? 'Untitled Story',
      genre: init.genre ?? '',
      scenario: init.scenario ?? '',
      bible: init.bible ?? '',
      style: init.style ?? '',
      exemplars: init.exemplars ?? '',
      instruct: init.instruct ?? '',
      personaId: init.personaId ?? null,
      characterId: init.characterId ?? null,
      templateId: init.templateId ?? null,
      model: init.model ?? 'deepseek-flash',
      effort: init.effort ?? 'none',
      temperature: init.temperature ?? 1,
      topP: init.topP ?? 0.98,
      maxTokens: init.maxTokens ?? 900,
      targetWords: init.targetWords ?? 300,
      contract: init.contract ?? '',
      loreBudget: init.loreBudget ?? 2000,
      historyBudget: init.historyBudget ?? 32000,
      prefill: init.prefill ?? '',
      theme: init.theme ?? 'ink',
      cover: init.cover ?? null,
      synopsis: init.synopsis ?? '',
      createdAt: now,
      updatedAt: now,
    };

    getDb()
      .prepare(
        `INSERT INTO stories (
           id, title, genre, scenario, bible, style, exemplars, instruct, persona_id,
           character_id, template_id, model, effort, temperature, top_p, max_tokens, target_words,
           contract, lore_budget, history_budget, prefill, theme, cover, synopsis, created_at,
           updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        story.id, story.title, story.genre, story.scenario, story.bible, story.style,
        story.exemplars, story.instruct, story.personaId, story.characterId, story.templateId,
        story.model, story.effort, story.temperature, story.topP, story.maxTokens, story.targetWords,
        story.contract,
        story.loreBudget, story.historyBudget, story.prefill, story.theme, story.cover,
        story.synopsis, story.createdAt, story.updatedAt,
      );

    return story;
  },

  update(id: string, patch: Partial<Story>): Story | null {
    const existing = stories.get(id);
    if (!existing) return null;
    const merged: Story = { ...existing, ...patch, id, updatedAt: Date.now() };

    getDb()
      .prepare(
        `UPDATE stories SET
           title=?, genre=?, scenario=?, bible=?, style=?, exemplars=?, instruct=?, persona_id=?,
           character_id=?, template_id=?, model=?, effort=?, temperature=?, top_p=?, max_tokens=?,
           target_words=?, contract=?,
           lore_budget=?, history_budget=?, prefill=?, theme=?, cover=?, synopsis=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        merged.title, merged.genre, merged.scenario, merged.bible, merged.style,
        merged.exemplars, merged.instruct, merged.personaId, merged.characterId, merged.templateId,
        merged.model, merged.effort, merged.temperature, merged.topP, merged.maxTokens,
        merged.targetWords, merged.contract,
        merged.loreBudget, merged.historyBudget, merged.prefill, merged.theme, merged.cover,
        merged.synopsis, merged.updatedAt, id,
      );

    return merged;
  },

  /** The chat started from this card, if the writer has one. At most one exists. */
  chatFor(characterId: string): Story | null {
    const row = getDb().prepare('SELECT * FROM stories WHERE character_id = ?').get(characterId) as
      | Row
      | undefined;
    return row ? toStory(row) : null;
  },

  /** Chats started from any of these cards. Used to report a cascade before it runs. */
  chatsForCharacters(characterIds: readonly string[]): Story[] {
    if (characterIds.length === 0) return [];
    const placeholders = characterIds.map(() => '?').join(',');
    const rows = getDb()
      .prepare(`SELECT * FROM stories WHERE character_id IN (${placeholders}) ORDER BY updated_at DESC`)
      .all(...characterIds) as Row[];
    return rows.map(toStory);
  },

  /** Forget a prompt template everywhere it is linked. One UPDATE, one transaction. */
  clearTemplate(templateId: string): void {
    getDb().prepare('UPDATE stories SET template_id = NULL WHERE template_id = ?').run(templateId);
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM stories WHERE id = ?').run(id);
  },

  touch(id: string): void {
    getDb().prepare('UPDATE stories SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  },
};
