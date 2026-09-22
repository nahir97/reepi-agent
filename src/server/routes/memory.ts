/**
 * Memory routes: manual memory curation, plus the local recall path.
 *
 * Recall is the cheapest useful thing in the app. `memories.recall` runs BM25 over
 * an in-process FTS5 index — no embeddings, no network, **no API spend** — and it
 * is the default way the transcript gets grounded. Every response says so
 * explicitly, because a feature that looks like it costs money but does not is
 * exactly the thing this product should be shouting about.
 */

import { Hono } from 'hono';
import { asInt, asString, fail, notFound, readBody } from '../http.ts';
import { getDb } from '../db.ts';
import { extractTerms } from '../lorebook.ts';
import { memories, messages, stories } from '../store/index.ts';
import type { Memory } from '../../shared/types.ts';
import { sanitiseMemory } from './library.ts';

const mod = new Hono();

/** A recall hit, as the UI consumes it. `costUsd` is structural, not decorative. */
export type RecallHit = { memory: Memory; score: number };

export type RecallResponse = {
  query: string;
  terms: string[];
  hits: RecallHit[];
  /** Always false: recall is local BM25 over the FTS5 index, never an API call. */
  usedApi: false;
  /** Always 0: this endpoint cannot spend credit. */
  costUsd: 0;
};

/**
 * `store.ts` exposes no `memories.get`, and deleting is idempotent from the
 * writer's point of view only if we can tell a real id from a stale one. One
 * point lookup on the shared handle answers that; everything else goes through the
 * DAO.
 */
function memoryExists(id: string): boolean {
  const row = getDb().prepare('SELECT 1 AS found FROM memories WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row !== undefined;
}

mod.get('/stories/:id/memories', (c) => {
  const story = stories.get(c.req.param('id') ?? '');
  if (!story) return notFound(c, 'Story');
  return c.json<Memory[]>(memories.list(story.id));
});

mod.post('/stories/:id/memories', async (c) => {
  const story = stories.get(c.req.param('id') ?? '');
  if (!story) return notFound(c, 'Story');

  const body = await readBody<Partial<Memory>>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const sanitised = sanitiseMemory(body);
  if (sanitised.rejected.length > 0) {
    return fail(c, 400, 'Invalid memory fields', `Unusable values for: ${sanitised.rejected.join(', ')}`);
  }
  const patch = sanitised.patch;

  const text = (patch.text ?? '').trim();
  if (!text) return fail(c, 400, 'Invalid memory', 'A memory needs text.');

  const memory = memories.add({
    storyId: story.id,
    text,
    subject: patch.subject ?? '',
    sourceMessageId: patch.sourceMessageId ?? null,
    // Position in the transcript, so a manually added memory sits at the end of
    // the recency scale rather than claiming to be the oldest thing known.
    seq: patch.seq ?? messages.count(story.id),
    // `sanitiseMemory` has already clamped this to 0..1.
    salience: patch.salience ?? 0.5,
    kind: patch.kind ?? 'fact',
  });

  return c.json<Memory>(memory);
});

mod.delete('/memories/:id', (c) => {
  const id = c.req.param('id') ?? '';
  if (!memoryExists(id)) return notFound(c, 'Memory');
  memories.remove(id);
  return c.json<{ ok: true }>({ ok: true });
});

mod.post('/stories/:id/recall', async (c) => {
  const story = stories.get(c.req.param('id') ?? '');
  if (!story) return notFound(c, 'Story');

  const body = await readBody<{ query?: string; limit?: number }>(c);
  if (!body) return fail(c, 400, 'Invalid body', 'Expected a JSON object.');

  const query = asString(body.query).trim();
  if (!query) return fail(c, 400, 'Invalid query', 'Recall needs a `query` string to search for.');

  const limit = Math.min(50, Math.max(1, asInt(body.limit, 8)));
  const terms = extractTerms(query);
  const hits = memories.recall(story.id, terms, limit);

  return c.json<RecallResponse>({ query, terms, hits, usedApi: false, costUsd: 0 });
});

export default mod;
