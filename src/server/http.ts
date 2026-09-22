import type { Context } from 'hono';

/**
 * Small HTTP helpers. Hono's own `c.json` is fine, but the routes need a
 * consistent error envelope and a typed body reader so a malformed request turns
 * into a 400 instead of a stack trace.
 */

export type ApiError = { error: string; detail?: string };

export function fail(c: Context, status: 400 | 401 | 404 | 409 | 500, error: string, detail?: string) {
  return c.json<ApiError>({ error, ...(detail ? { detail } : {}) }, status);
}

export function notFound(c: Context, what: string) {
  return fail(c, 404, `${what} not found`);
}

export async function readBody<T>(c: Context): Promise<T | null> {
  try {
    const body = await c.req.json();
    return (body ?? {}) as T;
  } catch {
    return null;
  }
}

/**
 * Merge a partial patch onto an existing row without letting a client set
 * identity or ownership columns.
 */
export function pickPatch<T extends object>(patch: Partial<T>, allowed: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of allowed) {
    if (key in patch && patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}

export function asInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}


export function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
