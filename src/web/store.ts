/**
 * The store barrel.
 *
 * The store itself lives in `./store/`, split into slices that receive zustand's
 * own `set`/`get` and are composed once in `store/index.ts`. This file exists so
 * every component keeps importing from `./store.ts` (or `../store.ts`) and never
 * has to learn about the split — a barrel is cheap, and it means moving an action
 * between slices never becomes a cross-cutting edit.
 *
 * This must stay a barrel. Logic here would belong in a slice.
 */

export { useStore } from './store/index.ts';
export type {
  Dialog,
  Drawer,
  LiveToolEvent,
  RightTab,
  Store,
  StoryStat,
  StreamingState,
  Toast,
  TurnOverrides,
} from './store/types.ts';
