/**
 * The cache-safety sentence.
 *
 * The one cache fact shown by default on the writing surface, because it is the
 * only one the writer must act on to keep writing: what the last edit did to the
 * prefix, in tokens. It is a *sentence*, not a metric — the numbers that are read
 * deliberately (predicted hit rate, price, the block-by-block split) live in Turn
 * details and Settings → Payload report.
 *
 * Everything here reads the server's own `PayloadPlan`; nothing is computed
 * client-side.
 */

import { formatPercent, formatTokens } from '../../shared/cost.ts';
import { BLOCK_LABELS, BLOCK_VOLATILITY } from '../../shared/types.ts';
import type { PayloadPlan } from '../../shared/types.ts';

/** The first block whose hash moved since last turn — the prefix-breaker. */
function firstChanged(plan: PayloadPlan | null): { label: string; tokens: number; volatility: number } | null {
  if (!plan) return null;
  const ordered = [...plan.blocks].sort((a, b) => a.stablePrefixTokens - b.stablePrefixTokens);
  for (const block of ordered) {
    if (!block.changed) continue;
    return { label: block.label || BLOCK_LABELS[block.kind], tokens: block.tokens, volatility: BLOCK_VOLATILITY[block.kind] };
  }
  return null;
}

/**
 * Names the block that broke the prefix and says, in plain words, how big the
 * damage is.
 */
export function cacheSafetySentence(plan: PayloadPlan | null): { text: string; level: 'safe' | 'warn' | 'danger' } | null {
  if (!plan) return null;
  const broken = firstChanged(plan);
  const prefix = plan.stablePrefixTokens;
  if (!broken) {
    if (plan.totalTokens === 0) return null;
    const rate = plan.predictedHitRate;
    return {
      level: rate >= 0.8 ? 'safe' : rate >= 0.5 ? 'warn' : 'danger',
      text: `Nothing edited. ${formatTokens(prefix)} of ${formatTokens(plan.totalTokens)} tokens ride the live prefix — ${formatPercent(rate)} predicted hit rate.`,
    };
  }
  const invalidated = Math.max(0, plan.stablePrefixTokens);
  const level = broken.volatility <= 1 ? 'danger' : broken.volatility === 2 ? 'warn' : 'safe';
  if (broken.volatility <= 1) {
    return {
      level,
      text: `Editing ${broken.label.toLowerCase()} changes a frozen block. It invalidates the whole ${formatTokens(prefix)} prefix behind it — everything re-pays the miss price.`,
    };
  }
  if (broken.volatility === 2) {
    return {
      level,
      text: `${broken.label} changed (${formatTokens(broken.tokens)} tokens). Blocks after it — ${formatTokens(invalidated)} tokens — go cold this turn.`,
    };
  }
  return {
    level,
    text: `${broken.label} changed, but it sits in the volatile tail: only its own ${formatTokens(broken.tokens)} tokens miss.`,
  };
}
