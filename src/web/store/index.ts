/**
 * The one store.
 *
 * zustand's `create` may be called exactly once — a second call would mint a
 * detached copy of the state — so every slice receives zustand's own `set`/`get`
 * and returns its piece, and they are spread together here. Slices therefore
 * never import each other: when one action needs another it calls
 * `get().thatAction()`, which is also what keeps them independent.
 *
 * Everything the studio knows lives behind this hook: the library, the open
 * story's bundle, the live payload plan the cache meter reads, the in-flight
 * stream, the cost instruments, and the chrome state. Server responses are the
 * single source of truth for money and usage — nothing here invents a cost.
 */

import { create } from 'zustand';

import { initialState } from './initial.ts';
import { creatorSlice } from './slices/creator.ts';
import { gettersSlice } from './slices/getters.ts';
import { instrumentsSlice } from './slices/instruments.ts';
import { librarySlice } from './slices/library.ts';
import { messagesSlice } from './slices/messages.ts';
import { portabilitySlice } from './slices/portability.ts';
import { templatesSlice } from './slices/templates.ts';
import { turnsSlice } from './slices/turns.ts';
import type { Store } from './types.ts';

export const useStore = create<Store>((set, get) => {
  const slice = { get, set };
  return {
    ...initialState(),
    ...librarySlice(slice),
    ...turnsSlice(slice),
    ...messagesSlice(slice),
    ...instrumentsSlice(slice),
    ...portabilitySlice(slice),
    ...templatesSlice(slice),
    ...creatorSlice(slice),
    ...gettersSlice(slice),
  };
});

export { IDLE_STREAM } from './initial.ts';
export { applyTheme } from './theme.ts';
export type {
  AppliedTemplate,
  CreatorState,
  Dialog,
  Drawer,
  LiveToolEvent,
  Page,
  RightTab,
  Store,
  StoryStat,
  StreamingState,
  Toast,
  TurnOverrides,
} from './types.ts';
