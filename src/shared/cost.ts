import {
  BASELINE_HIT_PRICE,
  PRICING_OFF_PEAK,
  PRICING_PEAK,
  type ModelId,
  type ModelPricing,
} from './types.ts';

/**
 * Peak windows are 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday, excluding
 * Chinese public holidays (which we cannot enumerate, so they are simply not
 * modelled — the cost readout is therefore a slight over-estimate on those days).
 *
 * Everything outside those two windows is off-peak and costs exactly half.
 */
export const PEAK_WINDOWS_UTC: readonly (readonly [number, number])[] = [
  [1, 4],
  [6, 10],
];

/**
 * Milliseconds until half-price billing resumes. Peak never straddles a day
 * boundary (both windows sit inside 01:00–10:00 UTC), so this is simply the time
 * remaining in the window currently being billed at the higher rate.
 */
export function msUntilOffPeak(now: number = Date.now()): number {
  if (!isPeak(now)) return 0;
  const date = new Date(now);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  for (const [start, end] of PEAK_WINDOWS_UTC) {
    if (minutes >= start * 60 && minutes < end * 60) {
      return (end * 60 - minutes) * 60_000 - date.getUTCSeconds() * 1000;
    }
  }
  return 0;
}

export function isPeak(now: number = Date.now()): boolean {
  const date = new Date(now);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  for (const [start, end] of PEAK_WINDOWS_UTC) {
    if (minutes >= start * 60 && minutes < end * 60) return true;
  }
  return false;
}

export function pricingFor(model: ModelId, peak: boolean): ModelPricing {
  return peak ? PRICING_PEAK[model] : PRICING_OFF_PEAK[model];
}

export type TokenSplit = {
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
};

export function costOf(model: ModelId, split: TokenSplit, peak: boolean): number {
  const price = pricingFor(model, peak);
  return (
    (split.cacheHitTokens * price.cacheHit) / 1e6 +
    (split.cacheMissTokens * price.cacheMiss) / 1e6 +
    (split.outputTokens * price.output) / 1e6
  );
}

/**
 * What the same request would have cost had every input token missed the cache.
 * The difference is the saving the cache discipline actually bought you.
 */
export function coldCostOf(model: ModelId, split: TokenSplit, peak: boolean): number {
  return costOf(
    model,
    {
      cacheHitTokens: 0,
      cacheMissTokens: split.cacheHitTokens + split.cacheMissTokens,
      outputTokens: split.outputTokens,
    },
    peak,
  );
}

export function savedBy(model: ModelId, split: TokenSplit, peak: boolean): number {
  return Math.max(0, coldCostOf(model, split, peak) - costOf(model, split, peak));
}

export function hitRate(split: Pick<TokenSplit, 'cacheHitTokens' | 'cacheMissTokens'>): number {
  const total = split.cacheHitTokens + split.cacheMissTokens;
  return total > 0 ? split.cacheHitTokens / total : 0;
}

/**
 * Cache hits expressed in multiples of the cheapest possible token. A cache hit
 * on flash costs 1 unit; a miss on flash off-peak costs 50; a v4-pro miss at peak
 * costs 440. One number that makes the discipline legible.
 */
export function cacheMultiplier(model: ModelId, peak: boolean): number {
  return pricingFor(model, peak).cacheMiss / BASELINE_HIT_PRICE;
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '$0.00';
  if (amount === 0) return '$0.00';
  const abs = Math.abs(amount);
  if (abs < 0.0001) return `$${amount.toFixed(6)}`;
  if (abs < 0.01) return `$${amount.toFixed(5)}`;
  if (abs < 1) return `$${amount.toFixed(4)}`;
  if (abs < 100) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count));
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 2 : 1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** "in 3h 12m" / "now" — used by the off-peak advisor. */
export function formatCountdown(ms: number): string {
  if (ms <= 30_000) return 'now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
