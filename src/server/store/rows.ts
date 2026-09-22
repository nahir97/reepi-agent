/**
 * Row plumbing shared by every store module.
 *
 * `node:sqlite` returns rows with a null prototype and knows only how to bind
 * null/number/bigint/string/Uint8Array, so values are narrowed at the boundary and
 * the DAOs downstream can stay declarative. `Row` is intentionally `unknown`-valued:
 * every read goes through `str`/`num`, which is what turns a schema change into a
 * type error rather than a silent `undefined`.
 */

export type Row = Record<string, unknown>;

export const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' ? value : Number(value ?? fallback) || fallback;

export const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
