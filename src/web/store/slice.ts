/**
 * The slice seam.
 *
 * `create<Store>()` may be called exactly once — zustand's `create` mints one
 * store, so a second call would give every consumer a detached copy of the
 * state. Each slice therefore receives zustand's own `set`/`get` and returns its
 * piece of the one store; `./index.ts` spreads them together.
 *
 * The setter type is *derived from zustand's own `StateCreator`* rather than
 * restated. Hand-writing `(partial: Partial<Store>) => void` is the obvious
 * approach and the wrong one: zustand's setter also accepts a partial-producing
 * function and a `replace` flag, and a narrower signature rejects both at every
 * call site.
 */

import type { StateCreator } from 'zustand';

import type { Store } from './types.ts';

/** Zustand's own `(set, get)` pair, narrowed to this store. */
export type Slice = Parameters<StateCreator<Store>> extends [infer S, infer G, ...unknown[]]
  ? { set: S; get: G }
  : never;
