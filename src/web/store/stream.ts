/**
 * Streaming: the event reducer, and the one function that runs a turn.
 *
 * `ingest` is intentionally a pure state reducer over a `StreamEvent` — every
 * frame the server sends maps to exactly one `set`. Keeping it separate from
 * `runTurn` means the stream protocol can be reasoned about without also
 * reasoning about fetch, abort, and reconciliation.
 */

import type { Message, MessageOrigin, StreamEvent } from '../../shared/types.ts';
import type { Slice } from './slice.ts';
import { localMessage, pushLocalMessage } from './slices/helpers.ts';

/** Fold one server frame into the live streaming state. */
export function ingest(slice: Slice, event: StreamEvent): void {
  const { get, set } = slice;
  const { streaming } = get();
  switch (event.type) {
    case 'plan':
      set({ plan: event.plan });
      return;
    case 'start':
      set({
        streaming: { ...streaming, messageId: event.messageId, startedAt: Date.now() },
      });
      return;
    case 'text':
      set({ streaming: { ...get().streaming, text: get().streaming.text + event.delta } });
      return;
    case 'reasoning':
      set({ streaming: { ...get().streaming, reasoning: get().streaming.reasoning + event.delta } });
      return;
    case 'tool':
      set({
        streaming: {
          ...get().streaming,
          tools: [
            ...get().streaming.tools,
            { name: event.name, args: event.args, ok: event.ok, summary: event.summary },
          ],
        },
      });
      return;
    case 'usage':
      set({ streaming: { ...get().streaming, usage: event.usage } });
      return;
    case 'note':
      set({ streaming: { ...get().streaming, notes: [...get().streaming.notes, event.note] } });
      return;
    case 'tip':
      set({ streaming: { ...get().streaming, tips: [...get().streaming.tips, ...event.advice] } });
      return;
    case 'error':
      set({ streaming: { ...get().streaming, error: event.message } });
      get().toast({ kind: 'error', title: 'Generation failed', detail: event.message });
      return;
    case 'aborted':
      set({ streaming: { ...get().streaming, error: null } });
      return;
    case 'done':
    default:
      return;
  }
}

export type { Message, MessageOrigin };
