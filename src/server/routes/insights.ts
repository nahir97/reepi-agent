/**
 * Cost insight: pure aggregation over the ledger.
 *
 * Nothing in this module calls the API. Every figure is recomputed from the
 * `cost_events` rows the turn engine already wrote, which is the only place usage
 * is ever trusted from (see the architectural invariants). That makes these
 * endpoints free to poll — a dashboard you are afraid to refresh is a dashboard
 * nobody reads.
 *
 * Two definitions are worth pinning down, because getting them wrong makes the
 * numbers flatter than reality:
 *
 * - **Hit rate is token-weighted**, not the mean of per-request rates. A 40k-token
 *   turn that missed and a 2k-token turn that hit must not average to 50%.
 * - **The naive projection re-prices the recorded events**, rather than applying a
 *   blanket multiplier. Each event knows its own model and peak window, so
 *   treating its hits as misses uses the rates that actually applied at the time.
 */

import { Hono } from 'hono';
import {
  cacheMultiplier,
  coldCostOf,
  hitRate,
  isPeak,
  msUntilOffPeak,
  pricingFor,
} from '../../shared/cost.ts';
import type { Insights } from '../../shared/api.ts';
import type { CostEvent, CostEventKind, ModelId } from '../../shared/types.ts';
import { notFound } from '../http.ts';
import { ledger, messages, stories, warmups } from '../store/index.ts';

const mod = new Hono();

/** The window every insight is computed over. */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Sparkline resolution: more points than this and the line is noise. */
const TIMELINE_POINTS = 200;

type Bucket = { costUsd: number; requests: number; hit: number; miss: number };

function bucketOf(buckets: Record<string, Bucket>, key: string): Bucket {
  const existing = buckets[key];
  if (existing) return existing;
  const fresh: Bucket = { costUsd: 0, requests: 0, hit: 0, miss: 0 };
  buckets[key] = fresh;
  return fresh;
}

/**
 * The newest event the *current view* can see. `ledger.recent` is global, so a
 * story view must filter by `storyId` — otherwise one story's dashboard would
 * report another story's spend as its own last turn.
 */
function lastEvent(storyId: string | null): CostEvent | null {
  return ledger.recent(TIMELINE_POINTS).find((event) => storyId === null || event.storyId === storyId) ?? null;
}

function emptyInsights(storyId: string | null): Insights {
  return {
    totals: {
      costUsd: 0,
      savedUsd: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      requests: 0,
      hitRate: 0,
      cacheRatio: cacheMultiplier('deepseek-flash', isPeak()),
      wordsWritten: storyId ? messages.assistantWords(storyId) : 0,
    },
    byKind: [],
    byModel: [],
    timeline: [],
    last: null,
    peak: isPeak(),
    msUntilOffPeak: msUntilOffPeak(),
    projection: { perTurnUsd: 0, per100TurnsUsd: 0, per1kWordsUsd: 0, naivePer100TurnsUsd: 0 },
    warmup: storyId ? warmups.get(storyId) : null,
  };
}

/**
 * The multiple the cache actually bought, derived from the recorded events rather
 * than assumed. Each event knows its own model and peak window, so what a hit cost
 * it versus what a miss cost it is known exactly — a window mixing flash and pro
 * therefore reports the blend it really paid rather than a marketing constant.
 *
 * Weighted by each event's input tokens, not a plain mean over requests: a tiny
 * judge call must not move the headline number for a writer sending million-token
 * turns. (Peak scales a model's hit and miss prices equally, so this ratio is
 * invariant to it by construction — only the model mix moves it.)
 */
function realisedCacheRatio(events: readonly CostEvent[]): number {
  if (events.length === 0) return cacheMultiplier('deepseek-flash', isPeak());
  let weighted = 0;
  let inputTokens = 0;
  let sum = 0;
  for (const event of events) {
    const price = pricingFor(event.model, event.peak);
    const ratio = price.cacheMiss / price.cacheHit;
    const tokens = event.cacheHitTokens + event.cacheMissTokens;
    weighted += ratio * tokens;
    inputTokens += tokens;
    sum += ratio;
  }
  if (inputTokens > 0) return weighted / inputTokens;
  return sum / events.length;
}

function buildInsights(storyId: string | null): Insights {
  const since = Date.now() - WINDOW_MS;
  const events = ledger.summary(storyId, since);

  if (events.length === 0) return emptyInsights(storyId);

  const totals = {
    costUsd: 0,
    savedUsd: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    requests: events.length,
    hitRate: 0,
    cacheRatio: realisedCacheRatio(events),
    wordsWritten: storyId ? messages.assistantWords(storyId) : 0,
  };

  const kindBuckets: Record<string, Bucket> = {};
  const modelBuckets: Record<string, Bucket> = {};
  const timeline: Insights['timeline'] = [];

  /** What these exact events would have cost with a permanently cold cache. */
  let naiveTotal = 0;

  for (const event of events) {
    const split = {
      cacheHitTokens: event.cacheHitTokens,
      cacheMissTokens: event.cacheMissTokens,
      outputTokens: event.outputTokens,
    };

    totals.costUsd += event.costUsd;
    totals.savedUsd += event.savedUsd;
    totals.cacheHitTokens += event.cacheHitTokens;
    totals.cacheMissTokens += event.cacheMissTokens;
    totals.outputTokens += event.outputTokens;
    totals.reasoningTokens += event.reasoningTokens;
    naiveTotal += coldCostOf(event.model, split, event.peak);

    const kind = bucketOf(kindBuckets, event.kind);
    kind.costUsd += event.costUsd;
    kind.requests += 1;
    kind.hit += event.cacheHitTokens;
    kind.miss += event.cacheMissTokens;

    const model = bucketOf(modelBuckets, event.model);
    model.costUsd += event.costUsd;
    model.requests += 1;
    model.hit += event.cacheHitTokens;
    model.miss += event.cacheMissTokens;

    timeline.push({
      at: event.createdAt,
      costUsd: event.costUsd,
      hitRate: hitRate(split),
      kind: event.kind,
    });
  }

  totals.hitRate = hitRate(totals);

  // `ledger.summary` is chronological, so the tail is the most recent stretch.
  const trimmed = timeline.length > TIMELINE_POINTS ? timeline.slice(-TIMELINE_POINTS) : timeline;

  const byKind: Insights['byKind'] = Object.entries(kindBuckets)
    .map(([kind, bucket]) => ({
      kind: kind as CostEventKind,
      costUsd: bucket.costUsd,
      requests: bucket.requests,
      hitRate: hitRate({ cacheHitTokens: bucket.hit, cacheMissTokens: bucket.miss }),
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);

  const byModel: Insights['byModel'] = Object.entries(modelBuckets)
    .map(([model, bucket]) => ({
      model: model as ModelId,
      costUsd: bucket.costUsd,
      requests: bucket.requests,
      hitRate: hitRate({ cacheHitTokens: bucket.hit, cacheMissTokens: bucket.miss }),
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);

  const perTurnUsd = totals.costUsd / totals.requests;
  const thousandWords = totals.wordsWritten / 1000;

  return {
    totals,
    byKind,
    byModel,
    timeline: trimmed,
    last: lastEvent(storyId),
    peak: isPeak(),
    msUntilOffPeak: msUntilOffPeak(),
    projection: {
      perTurnUsd,
      per100TurnsUsd: perTurnUsd * 100,
      // Guarded: a story with narration but no counted words must not divide by zero.
      per1kWordsUsd: thousandWords > 0 ? totals.costUsd / thousandWords : 0,
      naivePer100TurnsUsd: (naiveTotal / totals.requests) * 100,
    },
    warmup: storyId ? warmups.get(storyId) : null,
  };
}

mod.get('/stories/:id/insights', (c) => {
  const story = stories.get(c.req.param('id') ?? '');
  if (!story) return notFound(c, 'Story');
  return c.json<Insights>(buildInsights(story.id));
});

mod.get('/insights', (c) => c.json<Insights>(buildInsights(null)));

mod.get('/stories/:id/costs', (c) => {
  const story = stories.get(c.req.param('id') ?? '');
  if (!story) return notFound(c, 'Story');
  return c.json<CostEvent[]>(ledger.forStory(story.id));
});

export default mod;
