import { Hono } from 'hono';
import {
  estimateConductorCost,
  judgeVariants,
  runArchivist,
  runConductor,
  runDirector,
  runSummarise,
} from '../agents.ts';
import { composeTurn } from '../orchestrator.ts';
import { ledger, warmups } from '../store/index.ts';
import { fail, notFound, readBody, asInt, asString } from '../http.ts';
import { completeChat } from '../deepseek.ts';
import { costOf, isPeak } from '../../shared/cost.ts';
import type { ChatRequest, ModelId, ReasoningEffort } from '../../shared/types.ts';

/**
 * Agentic passes.
 *
 * Every one of these runs in a **separate context** from narration. That is the
 * architecture, not a workaround: the narrator's payload stays pristine and
 * cacheable (no tools, no reasoning echo, temperature honoured), while agents do
 * their expensive thinking in their own short-lived threads and hand back a tiny
 * durable artefact. Paying for a summary once and reusing it across fifty turns is
 * strictly cheaper than re-deriving continuity inside all fifty.
 *
 * Each route reports the real `costUsd` it incurred, computed from the API's own
 * usage numbers, so the ledger stays honest.
 */

const mod = new Hono();

mod.post('/stories/:id/director', async (c) => {
  const storyId = c.req.param('id');
  const body = await readBody<{ effort?: ReasoningEffort }>(c);
  const effort = body?.effort === 'none' || body?.effort === 'minimal' ? body.effort : 'low';
  try {
    const result = await runDirector(storyId, { effort });
    if (!result) return fail(c, 400, 'There is nothing in the transcript to direct yet.');
    return c.json(result);
  } catch (error) {
    return fail(c, 500, 'Director pass failed', describe(error));
  }
});

mod.post('/stories/:id/archivist', async (c) => {
  const storyId = c.req.param('id');
  const body = await readBody<{ limit?: number; sinceSeq?: number; model?: string }>(c);
  try {
    const result = await runArchivist(storyId, {
      limit: asInt(body?.limit ?? 20, 20),
      ...(body?.sinceSeq !== undefined ? { sinceSeq: asInt(body.sinceSeq, 0) } : {}),
      ...(body?.model ? { model: body.model as ModelId } : {}),
    });
    return c.json(result);
  } catch (error) {
    return fail(c, 500, 'Archivist pass failed', describe(error));
  }
});

mod.post('/stories/:id/summarise', async (c) => {
  const storyId = c.req.param('id');
  const body = await readBody<{ model?: string }>(c);
  try {
    const result = await runSummarise(storyId, {
      ...(body?.model ? { model: body.model as ModelId } : {}),
    });
    return c.json(result);
  } catch (error) {
    return fail(c, 500, 'Summary pass failed', describe(error));
  }
});

/**
 * Conductor: several continuations that share a byte-identical payload, then a
 * cheap judge picks one.
 *
 * The economics are the point. The variants run **sequentially** because a cache
 * unit only becomes servable once the first request has persisted it — racing them
 * in parallel would make every variant pay the miss price, which is 50× the hit
 * price. `estimateOnly: true` returns the projection before a cent is spent.
 */
mod.post('/stories/:id/conductor', async (c) => {
  const storyId = c.req.param('id');
  const body = await readBody<{
    variants?: number;
    judgeModel?: string;
    overrides?: ChatRequest['overrides'];
    estimateOnly?: boolean;
  }>(c);
  if (!body) return fail(c, 400, 'A JSON body is required');

  const variants = Math.min(6, Math.max(2, asInt(body.variants ?? 3, 3)));

  const payload = composeTurn({
    storyId,
    sceneId: '',
    mode: 'continue',
    ...(body.overrides ? { overrides: body.overrides } : {}),
  });
  if (!payload) return notFound(c, 'Story or scene');

  if (body.estimateOnly) {
    return c.json({
      variants,
      totalTokens: payload.plan.totalTokens,
      stablePrefixTokens: payload.plan.stablePrefixTokens,
      estimatedCostUsd: estimateConductorCost(
        payload.plan.totalTokens,
        payload.plan.estimate.outputTokens,
        variants,
        isPeak(),
      ),
      /** What the identical run costs if every variant has a cold cache. */
      worstCaseCostUsd: costOf(
        payload.model,
        {
          cacheHitTokens: 0,
          cacheMissTokens: payload.plan.totalTokens * variants,
          outputTokens: payload.plan.estimate.outputTokens * variants,
        },
        isPeak(),
      ),
      model: payload.model,
    });
  }

  try {
    // Identical messages for every variant — only temperature moves. That is what
    // makes variants 2..n cache hits.
    const result = await runConductor(
      storyId,
      {
        messages: payload.messages,
        model: payload.model,
        effort: payload.effort,
        topP: payload.topP,
        maxTokens: payload.maxTokens,
      },
      { variants },
    );
    return c.json(result);
  } catch (error) {
    return fail(c, 500, 'Conductor pass failed', describe(error));
  }
});

/** Second opinion on existing variants. */
mod.post('/stories/:id/judge', async (c) => {
  const storyId = c.req.param('id');
  const body = await readBody<{ candidates?: unknown; judgeModel?: string }>(c);
  const candidates = Array.isArray(body?.candidates)
    ? body.candidates.filter((item): item is string => typeof item === 'string')
    : [];
  if (candidates.length < 2) return fail(c, 400, 'At least two candidate strings are required.');
  try {
    const result = await judgeVariants(storyId, candidates, {
      ...(body?.judgeModel ? { judgeModel: body.judgeModel as ModelId } : {}),
    });
    return c.json(result);
  } catch (error) {
    return fail(c, 500, 'Judge pass failed', describe(error));
  }
});

/**
 * Cache warm-up.
 *
 * DeepSeek persists a cache prefix unit at each request boundary, but only once a
 * request at that exact shape has been made and had a few seconds to persist. A
 * freshly edited story therefore has a cold cache, and the next several turns all
 * pay miss prices. Warming pays that cost once, deliberately, with a tiny
 * completion — then proves it worked by re-sending the byte-identical payload and
 * reading the API's own hit accounting.
 */
mod.post('/stories/:id/warm', async (c) => {
  const storyId = c.req.param('id');
  const body = await readBody<{ overrides?: ChatRequest['overrides'] }>(c);

  const request: ChatRequest = {
    storyId,
    sceneId: '',
    mode: 'continue',
    ...(body?.overrides ? { overrides: body.overrides } : {}),
  };

  const payload = composeTurn(request);
  if (!payload) return notFound(c, 'Story or scene');

  const messages = payload.messages;
  if (payload.plan.totalTokens < 200) {
    return fail(
      c,
      400,
      'This story is too small to be worth warming — a cache prefix only pays for itself above a few hundred tokens.',
    );
  }

  try {
    const first = await completeChat({
      messages,
      model: payload.model,
      effort: payload.effort,
      maxTokens: 4,
    });

    const firstCost = costOf(
      payload.model,
      {
        cacheHitTokens: first.usage.cacheHitTokens,
        cacheMissTokens: first.usage.cacheMissTokens,
        outputTokens: first.usage.outputTokens,
      },
      isPeak(),
    );
    ledger.record({
      storyId,
      kind: 'narration',
      model: payload.model,
      cacheHitTokens: first.usage.cacheHitTokens,
      cacheMissTokens: first.usage.cacheMissTokens,
      outputTokens: first.usage.outputTokens,
      reasoningTokens: first.usage.reasoningTokens,
      costUsd: firstCost,
      savedUsd: 0,
      peak: isPeak(),
    });

    // Cache construction takes seconds; probing immediately would report a miss.
    const pause = Promise.withResolvers<void>();
    setTimeout(pause.resolve, 2500);
    await pause.promise;

    const second = await completeChat({
      messages,
      model: payload.model,
      effort: payload.effort,
      maxTokens: 4,
    });

    const secondCost = costOf(
      payload.model,
      {
        cacheHitTokens: second.usage.cacheHitTokens,
        cacheMissTokens: second.usage.cacheMissTokens,
        outputTokens: second.usage.outputTokens,
      },
      isPeak(),
    );
    ledger.record({
      storyId,
      kind: 'narration',
      model: payload.model,
      cacheHitTokens: second.usage.cacheHitTokens,
      cacheMissTokens: second.usage.cacheMissTokens,
      outputTokens: second.usage.outputTokens,
      reasoningTokens: second.usage.reasoningTokens,
      costUsd: secondCost,
      savedUsd: 0,
      peak: isPeak(),
    });

    const confirmedHit = second.usage.cacheHitTokens > 0;
    if (confirmedHit) {
      warmups.save({
        storyId,
        fingerprint: payload.plan.fingerprint,
        warmedAt: Date.now(),
        tokens: payload.plan.totalTokens,
        costUsd: secondCost,
      });
    }

    return c.json({
      fingerprint: payload.plan.fingerprint,
      tokens: payload.plan.totalTokens,
      confirmedHit,
      costUsd: firstCost + secondCost,
      firstPass: {
        cacheHitTokens: first.usage.cacheHitTokens,
        cacheMissTokens: first.usage.cacheMissTokens,
        ttftMs: first.ttftMs,
      },
      secondPass: {
        cacheHitTokens: second.usage.cacheHitTokens,
        cacheMissTokens: second.usage.cacheMissTokens,
        ttftMs: second.ttftMs,
      },
    });
  } catch (error) {
    return fail(c, 500, 'Warm-up failed', describe(error));
  }
});

function describe(error: unknown): string {
  return error instanceof Error ? error.message : asString(error, 'unknown error');
}

export default mod;
