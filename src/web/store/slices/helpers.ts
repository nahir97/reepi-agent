/**
 * Bundle-local mutations, and the optimistic row factory.
 *
 * One rule runs through all of them: a message row is an immutable snapshot, so
 * it is replaced by id rather than mutated in place. That keeps React's identity
 * comparisons honest and makes the reconcile-after-turn trivially correct.
 *
 * `localMessage` exists because the optimistic user row must appear before the
 * server has assigned anything. Its `seq` is deliberately `-1` — the
 * authoritative value arrives with the bundle re-read once the turn settles, and
 * nothing should trust the placeholder for ordering.
 */

import { bumpToastSeq } from '../runtime.ts';
import type { Message, MessageOrigin } from '../../../shared/types.ts';
import type { Slice } from '../slice.ts';

/** Monotonic client-side id for rows that do not exist on the server yet. */
export function nowId(): string {
  return `local-${Date.now().toString(36)}-${bumpToastSeq().toString(36)}`;
}

/** Patch one message inside the loaded bundle, if it is there. */
export function patchBundleMessage({ get, set }: Slice, messageId: string, patch: Partial<Message>): void {
  const bundle = get().bundle;
  if (!bundle) return;
  set({
    bundle: {
      ...bundle,
      messages: bundle.messages.map((message) =>
        message.id === messageId ? { ...message, ...patch } : message,
      ),
    },
  });
}

/** Append a row the server has not confirmed yet. */
export function pushLocalMessage({ get, set }: Slice, message: Message): void {
  const bundle = get().bundle;
  if (!bundle) return;
  set({ bundle: { ...bundle, messages: [...bundle.messages, message] } });
}

/** Build an optimistic row. The server replaces it with the real one. */
export function localMessage(
  { get }: Slice,
  role: Message['role'],
  origin: MessageOrigin,
  text: string,
  sceneId: string,
  id: string,
): Message {
  const at = Date.now();
  return {
    id,
    storyId: get().activeStoryId ?? '',
    sceneId,
    role,
    variants: [text],
    activeVariant: 0,
    reasoning: [''],
    origin,
    speaker: null,
    injections: [],
    usage: null,
    pinned: false,
    disabled: false,
    // Placeholder: the server assigns the authoritative value and the bundle
    // is re-read after the turn settles. Only used for local render ordering.
    seq: -1,
    createdAt: at,
    updatedAt: at,
  };
}

/** Replace a row by id, preserving array identity for every other row. */
export function replaceMessage(messages: Message[], next: Message): Message[] {
  return messages.map((message) => (message.id === next.id ? next : message));
}
