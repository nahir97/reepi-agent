/**
 * Per-entity patch sanitisers.
 *
 * Each takes an untrusted `Partial<T>` from a request body and returns a patch that
 * is safe to hand to a DAO, plus the names of any fields it had to reject — so the
 * route can answer 400 with a specific reason rather than silently dropping a value.
 */

import { asInt, asString, pickPatch } from '../../http.ts';
import { MEMORY_KINDS, NOTE_KINDS, isEditableBlock } from '../../../shared/types.ts';
import type { PromptTemplateBody } from '../../../shared/api.ts';
import type {
  Character,
  DirectorNote,
  EditableBlock,
  LoreEntry,
  Memory,
  Message,
  MessageUsage,
  Persona,
  PromptTemplate,
  Scene,
  SceneStateField,
  Story,
  Thread,
} from '../../../shared/types.ts';
import {
  EFFORT_IDS,
  MODEL_IDS,
  ORIGIN_IDS,
  POSITION_IDS,
  ROLE_IDS,
  THEME_IDS,
  THREAD_STATUSES,
  enumOf,
  finiteOf,
  objectOf,
  type Sanitised,
} from './shared.ts';

const STORY_TEXT_FIELDS = [
  'title', 'genre', 'scenario', 'bible', 'style', 'exemplars', 'instruct', 'contract', 'prefill', 'synopsis',
] as const;
const STORY_FLOAT_FIELDS = ['temperature', 'topP'] as const;
const STORY_INT_FIELDS = ['maxTokens', 'targetWords', 'loreBudget', 'historyBudget'] as const;
const STORY_NULLABLE_TEXT_FIELDS = ['personaId', 'cover', 'templateId'] as const;
const STORY_FIELDS = [
  ...STORY_TEXT_FIELDS,
  ...STORY_FLOAT_FIELDS,
  ...STORY_INT_FIELDS,
  ...STORY_NULLABLE_TEXT_FIELDS,
  'model',
  'effort',
  'theme',
] as const;

export function sanitiseStory(raw: Partial<Story>): Sanitised<Story> {
  const picked = pickPatch<Story>(raw, STORY_FIELDS);
  const patch: Partial<Story> = {};
  const rejected: string[] = [];

  for (const field of STORY_TEXT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    if (typeof value === 'string') patch[field] = value;
    else rejected.push(field);
  }
  for (const field of STORY_NULLABLE_TEXT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    if (typeof value === 'string' || value === null) patch[field] = value;
    else rejected.push(field);
  }
  for (const field of STORY_FLOAT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    const parsed = finiteOf(value);
    if (parsed === null) rejected.push(field);
    else patch[field] = parsed;
  }
  for (const field of STORY_INT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    const parsed = finiteOf(value);
    if (parsed === null) rejected.push(field);
    else patch[field] = Math.trunc(parsed);
  }

  if (picked.model !== undefined) {
    const model = enumOf(picked.model, MODEL_IDS);
    if (model) patch.model = model;
    else rejected.push('model');
  }
  if (picked.effort !== undefined) {
    const effort = enumOf(picked.effort, EFFORT_IDS);
    if (effort) patch.effort = effort;
    else rejected.push('effort');
  }
  if (picked.theme !== undefined) {
    const theme = enumOf(picked.theme, THEME_IDS);
    if (theme) patch.theme = theme;
    else rejected.push('theme');
  }

  return { patch, rejected };
}

const SCENE_TEXT_FIELDS = ['title', 'notes'] as const;
const SCENE_FIELDS = [...SCENE_TEXT_FIELDS, 'state', 'order', 'archived'] as const;

function stateFieldsOf(value: unknown): SceneStateField[] | null {
  if (!Array.isArray(value)) return null;
  const fields: SceneStateField[] = [];
  for (const item of value) {
    const record = objectOf(item);
    if (!record) return null;
    fields.push({ key: asString(record['key']), value: asString(record['value']) });
  }
  return fields;
}

export function sanitiseScene(raw: Partial<Scene>): Sanitised<Scene> {
  const picked = pickPatch<Scene>(raw, SCENE_FIELDS);
  const patch: Partial<Scene> = {};
  const rejected: string[] = [];

  for (const field of SCENE_TEXT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    if (typeof value === 'string') patch[field] = value;
    else rejected.push(field);
  }
  if (picked.state !== undefined) {
    const state = stateFieldsOf(picked.state);
    if (state) patch.state = state;
    else rejected.push('state');
  }
  if (picked.order !== undefined) {
    const order = finiteOf(picked.order);
    if (order === null) rejected.push('order');
    else patch.order = Math.trunc(order);
  }
  if (picked.archived !== undefined) {
    if (typeof picked.archived === 'boolean') patch.archived = picked.archived;
    else rejected.push('archived');
  }

  return { patch, rejected };
}

const CHARACTER_TEXT_FIELDS = [
  'name', 'tagline', 'description', 'personality', 'speech', 'scenario', 'exampleDialogue',
] as const;
const CHARACTER_FIELDS = [...CHARACTER_TEXT_FIELDS, 'meta', 'avatar', 'order'] as const;

export function sanitiseCharacter(raw: Partial<Character>): Sanitised<Character> {
  const picked = pickPatch<Character>(raw, CHARACTER_FIELDS);
  const patch: Partial<Character> = {};
  const rejected: string[] = [];

  for (const field of CHARACTER_TEXT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    if (typeof value === 'string') patch[field] = value;
    else rejected.push(field);
  }
  if (picked.avatar !== undefined) {
    if (typeof picked.avatar === 'string' || picked.avatar === null) patch.avatar = picked.avatar;
    else rejected.push('avatar');
  }
  if (picked.meta !== undefined) {
    const meta = objectOf(picked.meta);
    if (meta) patch.meta = meta;
    else rejected.push('meta');
  }
  if (picked.order !== undefined) {
    const order = finiteOf(picked.order);
    if (order === null) rejected.push('order');
    else patch.order = Math.trunc(order);
  }

  return { patch, rejected };
}

const PERSONA_FIELDS = ['name', 'description', 'isDefault', 'avatar'] as const;

export function sanitisePersona(raw: Partial<Persona>): Sanitised<Persona> {
  const picked = pickPatch<Persona>(raw, PERSONA_FIELDS);
  const patch: Partial<Persona> = {};
  const rejected: string[] = [];

  if (picked.name !== undefined) {
    if (typeof picked.name === 'string') patch.name = picked.name;
    else rejected.push('name');
  }
  if (picked.description !== undefined) {
    if (typeof picked.description === 'string') patch.description = picked.description;
    else rejected.push('description');
  }
  if (picked.avatar !== undefined) {
    if (typeof picked.avatar === 'string' || picked.avatar === null) patch.avatar = picked.avatar;
    else rejected.push('avatar');
  }
  if (picked.isDefault !== undefined) {
    if (typeof picked.isDefault === 'boolean') patch.isDefault = picked.isDefault;
    else rejected.push('isDefault');
  }

  return { patch, rejected };
}

const LORE_TEXT_FIELDS = ['title', 'body', 'keys'] as const;
const LORE_INT_FIELDS = ['depth', 'priority'] as const;
const LORE_FIELDS = [...LORE_TEXT_FIELDS, ...LORE_INT_FIELDS, 'weight', 'position', 'constant', 'enabled'] as const;

export function sanitiseLore(raw: Partial<LoreEntry>): Sanitised<LoreEntry> {
  const picked = pickPatch<LoreEntry>(raw, LORE_FIELDS);
  const patch: Partial<LoreEntry> = {};
  const rejected: string[] = [];

  for (const field of LORE_TEXT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    if (typeof value === 'string') patch[field] = value;
    else rejected.push(field);
  }
  for (const field of LORE_INT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    const parsed = finiteOf(value);
    if (parsed === null) rejected.push(field);
    else patch[field] = Math.trunc(parsed);
  }
  if (picked.weight !== undefined) {
    const weight = finiteOf(picked.weight);
    // Documented 0..1: it scales a retrieval score, so anything outside is a bug.
    if (weight === null) rejected.push('weight');
    else patch.weight = Math.min(1, Math.max(0, weight));
  }
  if (picked.position !== undefined) {
    const position = enumOf(picked.position, POSITION_IDS);
    if (position) patch.position = position;
    else rejected.push('position');
  }
  for (const field of ['constant', 'enabled'] as const) {
    const value = picked[field];
    if (value === undefined) continue;
    if (typeof value === 'boolean') patch[field] = value;
    else rejected.push(field);
  }

  return { patch, rejected };
}

const THREAD_NULLABLE_TEXT_FIELDS = ['sceneId', 'openedAt', 'resolvedAt'] as const;
const THREAD_FIELDS = ['label', ...THREAD_NULLABLE_TEXT_FIELDS, 'status'] as const;

export function sanitiseThread(raw: Partial<Thread>): Sanitised<Thread> {
  const picked = pickPatch<Thread>(raw, THREAD_FIELDS);
  const patch: Partial<Thread> = {};
  const rejected: string[] = [];

  if (picked.label !== undefined) {
    if (typeof picked.label === 'string') patch.label = picked.label;
    else rejected.push('label');
  }
  for (const field of THREAD_NULLABLE_TEXT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    if (typeof value === 'string' || value === null) patch[field] = value;
    else rejected.push(field);
  }
  if (picked.status !== undefined) {
    const status = enumOf(picked.status, THREAD_STATUSES);
    if (status) patch.status = status;
    else rejected.push('status');
  }

  return { patch, rejected };
}

const MEMORY_TEXT_FIELDS = ['text', 'subject'] as const;
const MEMORY_FIELDS = [...MEMORY_TEXT_FIELDS, 'sourceMessageId', 'seq', 'salience', 'kind'] as const;

export function sanitiseMemory(raw: Partial<Memory>): Sanitised<Memory> {
  const picked = pickPatch<Memory>(raw, MEMORY_FIELDS);
  const patch: Partial<Memory> = {};
  const rejected: string[] = [];

  for (const field of MEMORY_TEXT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    if (typeof value === 'string') patch[field] = value;
    else rejected.push(field);
  }
  if (picked.sourceMessageId !== undefined) {
    if (typeof picked.sourceMessageId === 'string' || picked.sourceMessageId === null) {
      patch.sourceMessageId = picked.sourceMessageId;
    } else rejected.push('sourceMessageId');
  }
  if (picked.seq !== undefined) {
    const seq = finiteOf(picked.seq);
    if (seq === null) rejected.push('seq');
    else patch.seq = Math.trunc(seq);
  }
  if (picked.salience !== undefined) {
    const salience = finiteOf(picked.salience);
    if (salience === null) rejected.push('salience');
    else patch.salience = Math.min(1, Math.max(0, salience));
  }
  if (picked.kind !== undefined) {
    const kind = enumOf(picked.kind, MEMORY_KINDS);
    if (kind) patch.kind = kind;
    else rejected.push('kind');
  }

  return { patch, rejected };
}

const NOTE_FIELDS = ['kind', 'body', 'messageId', 'payload', 'accepted'] as const;

export function sanitiseNote(raw: Partial<DirectorNote>): Sanitised<DirectorNote> {
  const picked = pickPatch<DirectorNote>(raw, NOTE_FIELDS);
  const patch: Partial<DirectorNote> = {};
  const rejected: string[] = [];

  if (picked.kind !== undefined) {
    const kind = enumOf(picked.kind, NOTE_KINDS);
    if (kind) patch.kind = kind;
    else rejected.push('kind');
  }
  if (picked.body !== undefined) {
    if (typeof picked.body === 'string') patch.body = picked.body;
    else rejected.push('body');
  }
  if (picked.messageId !== undefined) {
    if (typeof picked.messageId === 'string' || picked.messageId === null) patch.messageId = picked.messageId;
    else rejected.push('messageId');
  }
  if (picked.payload !== undefined) {
    if (picked.payload === null) patch.payload = null;
    else {
      const payload = objectOf(picked.payload);
      if (payload) patch.payload = payload;
      else rejected.push('payload');
    }
  }
  if (picked.accepted !== undefined) {
    if (typeof picked.accepted === 'boolean') patch.accepted = picked.accepted;
    else rejected.push('accepted');
  }

  return { patch, rejected };
}

const MESSAGE_STRING_LIST_FIELDS = ['variants', 'reasoning'] as const;
const MESSAGE_FIELDS = [
  ...MESSAGE_STRING_LIST_FIELDS,
  'sceneId',
  'role',
  'origin',
  'speaker',
  'injections',
  'usage',
  'pinned',
  'disabled',
  'activeVariant',
  'seq',
] as const;

function stringListOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === 'string') ? (value as string[]) : null;
}

/** Injection snapshots are display-only, but a half-shaped one renders as noise. */
function injectionsOf(value: unknown): Message['injections'] | null {
  if (!Array.isArray(value)) return null;
  const hits: Message['injections'] = [];
  for (const item of value) {
    const record = objectOf(item);
    if (!record) return null;
    hits.push({
      entryId: asString(record['entryId']),
      title: asString(record['title']),
      body: asString(record['body']),
      position: enumOf(record['position'], POSITION_IDS) ?? 'anchor',
      depth: asInt(record['depth'], 0),
      tokens: asInt(record['tokens'], 0),
      reason: asString(record['reason']),
      score: finiteOf(record['score']) ?? 0,
    });
  }
  return hits;
}

function usageOf(value: unknown): MessageUsage | null {
  const record = objectOf(value);
  if (!record) return null;
  const model = enumOf(record['model'], MODEL_IDS);
  const effort = enumOf(record['effort'], EFFORT_IDS);
  if (!model || !effort) return null;
  const ttft = finiteOf(record['ttftMs']);
  return {
    model,
    effort,
    cacheHitTokens: asInt(record['cacheHitTokens'], 0),
    cacheMissTokens: asInt(record['cacheMissTokens'], 0),
    outputTokens: asInt(record['outputTokens'], 0),
    reasoningTokens: asInt(record['reasoningTokens'], 0),
    ttftMs: ttft,
    totalMs: asInt(record['totalMs'], 0),
    costUsd: finiteOf(record['costUsd']) ?? 0,
    savedUsd: finiteOf(record['savedUsd']) ?? 0,
    fingerprint: asString(record['fingerprint']),
    peak: record['peak'] === true,
  };
}

export function sanitiseMessage(raw: Partial<Message>): Sanitised<Message> {
  const picked = pickPatch<Message>(raw, MESSAGE_FIELDS);
  const patch: Partial<Message> = {};
  const rejected: string[] = [];

  for (const field of MESSAGE_STRING_LIST_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    const list = stringListOf(value);
    if (list) patch[field] = list;
    else rejected.push(field);
  }
  if (picked.sceneId !== undefined) {
    if (typeof picked.sceneId === 'string') patch.sceneId = picked.sceneId;
    else rejected.push('sceneId');
  }
  if (picked.role !== undefined) {
    const role = enumOf(picked.role, ROLE_IDS);
    if (role) patch.role = role;
    else rejected.push('role');
  }
  if (picked.origin !== undefined) {
    const origin = enumOf(picked.origin, ORIGIN_IDS);
    if (origin) patch.origin = origin;
    else rejected.push('origin');
  }
  if (picked.speaker !== undefined) {
    if (typeof picked.speaker === 'string' || picked.speaker === null) patch.speaker = picked.speaker;
    else rejected.push('speaker');
  }
  if (picked.injections !== undefined) {
    const injections = injectionsOf(picked.injections);
    if (injections) patch.injections = injections;
    else rejected.push('injections');
  }
  if (picked.usage !== undefined) {
    if (picked.usage === null) patch.usage = null;
    else {
      const usage = usageOf(picked.usage);
      if (usage) patch.usage = usage;
      else rejected.push('usage');
    }
  }
  for (const field of ['pinned', 'disabled'] as const) {
    const value = picked[field];
    if (value === undefined) continue;
    if (typeof value === 'boolean') patch[field] = value;
    else rejected.push(field);
  }
  for (const field of ['activeVariant', 'seq'] as const) {
    const value = picked[field];
    if (value === undefined) continue;
    const parsed = finiteOf(value);
    if (parsed === null) rejected.push(field);
    else patch[field] = Math.trunc(parsed);
  }

  return { patch, rejected };
}

const TEMPLATE_TEXT_FIELDS = ['name', 'blurb'] as const;
const TEMPLATE_FIELDS = [...TEMPLATE_TEXT_FIELDS, 'blocks', 'sortOrder'] as const;

/**
 * Block text as sent by the client.
 *
 * Every key must be an editable block: a template that "fills" a block the
 * composer derives from rows would look saved and do nothing. Unknown keys are
 * reported by name so the caller learns which one was refused, and whitespace-only
 * text is dropped — a template that fills nothing is refused by the route rather
 * than stored as an empty promise.
 */
function templateBlocksOf(
  value: unknown,
): { blocks: Partial<Record<EditableBlock, string>> } | { bad: string } {
  const record = objectOf(value);
  if (!record) return { bad: 'blocks' };
  const blocks: Partial<Record<EditableBlock, string>> = {};
  for (const [key, text] of Object.entries(record)) {
    if (!isEditableBlock(key) || typeof text !== 'string') return { bad: `blocks.${key}` };
    if (text.trim()) blocks[key] = text;
  }
  return { blocks };
}

export function sanitisePromptTemplate(raw: PromptTemplateBody): Sanitised<PromptTemplate> {
  const picked = pickPatch<PromptTemplateBody>(raw, TEMPLATE_FIELDS);
  const patch: Partial<PromptTemplate> = {};
  const rejected: string[] = [];

  for (const field of TEMPLATE_TEXT_FIELDS) {
    const value = picked[field];
    if (value === undefined) continue;
    if (typeof value === 'string') patch[field] = value;
    else rejected.push(field);
  }
  if (picked.blocks !== undefined) {
    const parsed = templateBlocksOf(picked.blocks);
    if ('blocks' in parsed) patch.blocks = parsed.blocks;
    else rejected.push(parsed.bad);
  }
  if (picked.sortOrder !== undefined) {
    const order = finiteOf(picked.sortOrder);
    if (order === null) rejected.push('sortOrder');
    else patch.sortOrder = Math.trunc(order);
  }

  return { patch, rejected };
}
