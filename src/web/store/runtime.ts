/**
 * Module-level state that is deliberately shared by every slice.
 *
 * This is the one piece of genuinely global mutable state in the store, and it
 * must stay in a single module. `activeController` is what makes `abort()` work:
 * if a slice held its own copy, switching story or stopping a generation would
 * cancel nothing and the stream would keep running invisibly.
 *
 * `streamSeq` is a generation counter. A streaming turn captures its value and
 * ignores every event that arrives after the counter moves — that is how a stale
 * stream cannot paint text into a story the writer has already left.
 */

export let toastSeq = 0;
export let streamSeq = 0;
export let planTimer: number | undefined;
export let activeController: AbortController | null = null;
/**
 * The assistant's own in-flight call.
 *
 * A second slot rather than a reuse of `activeController`: a narration turn in one
 * story and an assistant turn are independent, and stopping one must never cancel
 * the other.
 */
export let creatorController: AbortController | null = null;

export function bumpToastSeq(): number {
  toastSeq += 1;
  return toastSeq;
}

export function bumpStreamSeq(): number {
  streamSeq += 1;
  return streamSeq;
}

/** Read the current generation without advancing it. */
export function currentStreamSeq(): number {
  return streamSeq;
}

export function setPlanTimer(handle: number | undefined): void {
  planTimer = handle;
}

export function planTimerHandle(): number | undefined {
  return planTimer;
}

export function setActiveController(controller: AbortController | null): void {
  activeController = controller;
}

export function abortActive(): void {
  activeController?.abort();
  activeController = null;
}

export function setCreatorController(controller: AbortController | null): void {
  creatorController = controller;
}

export function abortCreator(): void {
  creatorController?.abort();
  creatorController = null;
}
