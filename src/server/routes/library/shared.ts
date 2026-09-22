/**
 * Validation plumbing shared by every library sanitiser.
 *
 * Sanitising is not decoration: `pickPatch` drops identity and ownership columns
 * (`id`, `storyId`, `createdAt`), and each remaining value is coerced to the shape
 * its column expects. Without that, a JSON body carrying an object where a string
 * belongs reaches `node:sqlite` and surfaces as a 500.
 */

import type { Context } from 'hono';
import { fail, pickPatch } from '../../http.ts';
import { EFFORT_LABELS, MODELS } from '../../../shared/types.ts';
import type {
  LorePosition,
  MessageOrigin,
  ModelId,
  ReasoningEffort,
  Role,
  Theme,
  Thread,
} from '../../../shared/types.ts';

/** Path parameters are typed `string | undefined`; a declared route always has one. */
export function param(c: Context, name: string): string {
  return c.req.param(name) ?? '';
}

export function reject(c: Context, what: string, fields: readonly string[]) {
  return fail(c, 400, `Invalid ${what}`, `Unusable values for: ${fields.join(', ')}`);
}

export function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function enumOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** `Number(value)` accepting numeric strings, rejecting NaN/Infinity/objects. */
export function finiteOf(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const MODEL_IDS = Object.keys(MODELS) as readonly ModelId[];
export const EFFORT_IDS = Object.keys(EFFORT_LABELS) as readonly ReasoningEffort[];
export const THEME_IDS: readonly Theme[] = ['ink', 'ember', 'verdant', 'daylight'];
export const ROLE_IDS: readonly Role[] = ['system', 'user', 'assistant'];
export const ORIGIN_IDS: readonly MessageOrigin[] = [
  'user', 'narrator', 'continue', 'impersonate', 'greeting', 'rewrite', 'conductor', 'expansion',
];
export const POSITION_IDS: readonly LorePosition[] = ['anchor', 'depth', 'before', 'after'];
export const THREAD_STATUSES: readonly Thread['status'][] = ['open', 'closed'];

/** A sanitised patch plus the names of fields whose values could not be used. */
export type Sanitised<T> = { patch: Partial<T>; rejected: string[] };
