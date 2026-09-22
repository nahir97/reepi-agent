import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ChatRequest, StreamEvent } from '../../shared/types.ts';
import { planTurn, runTurn } from '../orchestrator.ts';
import { fail, notFound, readBody } from '../http.ts';

/**
 * The chat surface. Two routes:
 *
 * - `POST /plan` — dry run. Builds and reports the exact payload the next turn
 *   would send, including its cache-hit prediction, **without spending a cent**.
 *   This is what drives the live meter in the composer.
 * - `POST /chat` — the real thing, streamed as SSE.
 */

const mod = new Hono();

mod.post('/plan', async (c) => {
  const body = await readBody<ChatRequest>(c);
  if (!body?.storyId) return fail(c, 400, 'storyId is required');
  const plan = await planTurn(body);
  if (!plan) return notFound(c, 'Story or scene');
  return c.json(plan);
});

mod.post('/chat', async (c) => {
  const body = await readBody<ChatRequest>(c);
  if (!body?.storyId) return fail(c, 400, 'storyId is required');

  const controller = new AbortController();
  // Tie the upstream request to the client hanging up, so an aborted generation
  // stops billing immediately rather than running to completion.
  c.req.raw.signal.addEventListener('abort', () => controller.abort(), { once: true });

  return streamSSE(c, async (stream) => {
    /*
     * Writes are chained rather than fired-and-forgotten. `writeSSE` is async, and
     * a `void`-ed final write is dropped when the handler returns and Hono closes
     * the stream — which silently swallowed the closing `usage` and `done` frames.
     * Chaining also guarantees frames reach the client in emission order.
     */
    let pending: Promise<void> = Promise.resolve();
    const emit = (event: StreamEvent) => {
      pending = pending
        .then(() => stream.writeSSE({ event: 'message', data: JSON.stringify(event) }))
        .catch(() => {
          /* Client disconnected; nothing left to deliver to. */
        });
    };

    try {
      await runTurn(body, { emit, signal: controller.signal });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The generation failed for an unknown reason.';
      emit({ type: 'error', message });
    }

    if (controller.signal.aborted) emit({ type: 'aborted' });
    // Drain before returning, or the tail of the stream is lost.
    await pending;
  });
});

export default mod;
