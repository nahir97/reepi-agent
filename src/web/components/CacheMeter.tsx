/**
 * The signature widget: what this turn will cost, and how much of that the cache
 * is going to eat.
 *
 * Everything shown comes from the server's own `PayloadPlan` — total tokens, the
 * stable prefix, the token split, the predicted and the *measured* hit rate. The
 * ring is drawn against `--cache-hit` / `--cache-miss`, because the whole product
 * is that 50× spread made visible.
 */

import { formatTokens, formatUsd, formatPercent } from '../../shared/cost.ts';
import type { PayloadPlan } from '../../shared/types.ts';
import { BLOCK_LABELS, BLOCK_VOLATILITY } from '../../shared/types.ts';
import { IconAlert, IconChevronDown, IconGauge, IconLock } from './icons.tsx';
import { Metric } from './panel.tsx';

export type CacheMeterProps = {
  plan: PayloadPlan | null;
  busy?: boolean;
  /** `ring` for the composer, `bar` for the inspector rail. */
  variant?: 'ring' | 'bar';
  compact?: boolean;
};

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
 * The cache-safety sentence. Names the block that broke the prefix and says, in
 * plain words, how big the damage is.
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

function Ring({ ratio, size }: { ratio: number; size: number }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={3.5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--cache-hit)"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeDasharray={`${circumference * clamped} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 340ms cubic-bezier(0.22,1,0.36,1)' }}
      />
    </svg>
  );
}


/**
 * The one-line cache readout.
 *
 * This is what the writer sees by default: a live hit rate, the price of the
 * turn, and how much the cache took off it. Everything the full meter adds —
 * predicted versus measured, the token split, the block-level attribution — is
 * behind this button, because it is worth reading deliberately and not worth
 * reading while writing.
 */
export function CachePill({
  plan,
  busy = false,
  open,
  onToggle,
}: {
  plan: PayloadPlan | null;
  busy?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  if (!plan) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-faint">
        <IconGauge size={12} />
        <span className="num">{busy ? 'measuring…' : 'not measured'}</span>
      </span>
    );
  }

  const predicted = plan.predictedHitRate;
  const saving = Math.max(0, plan.estimate.coldCostUsd - plan.estimate.costUsd);
  const tone = predicted >= 0.8 ? 'var(--cache-hit)' : predicted >= 0.5 ? 'var(--warn)' : 'var(--cache-miss)';

  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-colors"
      style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
      onClick={onToggle}
      aria-expanded={open}
      title="This turn's payload: predicted cache hit, cost, and saving. Open for the full breakdown."
    >
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
      <span className="num" style={{ color: tone }}>
        {formatPercent(predicted)}
      </span>
      <span className="text-faint">cached</span>
      <span className="text-faint/60">·</span>
      <span className="num text-dim">{formatUsd(plan.estimate.costUsd)}</span>
      {saving > 0 ? (
        <>
          <span className="text-faint/60">·</span>
          <span className="num" style={{ color: 'var(--ok)' }}>
            −{formatUsd(saving)}
          </span>
        </>
      ) : null}
      <span className={`ml-0.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--text-faint)' }}>
        <IconChevronDown size={10} />
      </span>
    </button>
  );
}

export function CacheMeter({ plan, busy = false, variant = 'ring', compact = false }: CacheMeterProps) {
  if (!plan) {
    return (
      <div className="flex items-center gap-2 text-[11.5px] text-faint">
        <IconGauge size={13} />
        <span className="num">{busy ? 'measuring payload…' : 'no payload measured yet'}</span>
      </div>
    );
  }

  const { estimate } = plan;
  const predicted = plan.predictedHitRate;
  const previous = plan.previousHitRate;
  const saving = Math.max(0, estimate.coldCostUsd - estimate.costUsd);
  const prefixShare = plan.totalTokens > 0 ? plan.stablePrefixTokens / plan.totalTokens : 0;
  const ring = variant === 'ring';

  return (
    <div
      className={`rounded-lg border border-border ${compact ? 'p-2.5' : 'p-3'}`}
      style={{ background: 'var(--bg-sunken)' }}
      aria-label="Cache meter"
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Ring ratio={ring ? predicted : prefixShare} size={compact ? 44 : 54} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="num text-[12px] leading-none font-semibold" style={{ color: 'var(--cache-hit)' }}>
              {formatPercent(ring ? predicted : prefixShare)}
            </span>
            <span className="eyebrow mt-0.5" style={{ fontSize: 8 }}>
              {ring ? 'hit' : 'stable'}
            </span>
          </div>
        </div>

        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
          <Metric label="Payload" value={`${formatTokens(plan.totalTokens)} tok`} hint={`${plan.messages} messages`} />
          <Metric
            label="Stable prefix"
            value={`${formatTokens(plan.stablePrefixTokens)} tok`}
            tone="var(--cache-hit)"
            hint="Guaranteed to match the previous turn's payload from position 0"
          />
          <Metric
            label="This turn"
            value={formatUsd(estimate.costUsd)}
            tone="var(--accent)"
            hint={estimate.exact ? 'Exact, from the composer' : 'Estimated'}
          />
          <Metric
            label="Without cache"
            value={formatUsd(estimate.coldCostUsd)}
            tone="var(--cache-miss)"
            hint="Every input token paying the miss price"
          />
        </div>
      </div>

      {/* Predicted vs measured — the estimate keeping itself honest. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--cache-hit)' }} />
          <span className="text-faint">predicted</span>
          <span className="num" style={{ color: 'var(--cache-hit)' }}>
            {formatPercent(predicted)}
          </span>
        </span>
        {previous === null ? (
          <span className="text-faint italic">no measured turn yet to compare against</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--text-faint)' }} />
            <span className="text-faint">measured last turn</span>
            <span className="num text-dim">{formatPercent(previous)}</span>
            {Math.abs(previous - predicted) > 0.12 ? (
              <span className="text-faint">
                ({predicted > previous ? 'optimistic' : 'conservative'} by{' '}
                {formatPercent(Math.abs(predicted - previous))})
              </span>
            ) : null}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <IconLock size={11} />
          <span className="text-faint">saving</span>
          <span className="num font-semibold" style={{ color: saving > 0 ? 'var(--ok)' : 'var(--text-faint)' }}>
            {formatUsd(saving)}
          </span>
        </span>
      </div>

      {/* Split bar: how the input tokens actually divide. */}
      <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full border border-border">
        <div
          style={{
            width: `${Math.max(0, Math.min(100, (estimate.cacheHitTokens / Math.max(1, estimate.cacheHitTokens + estimate.cacheMissTokens)) * 100))}%`,
            background: 'var(--cache-hit)',
            transition: 'width 340ms cubic-bezier(0.22,1,0.36,1)',
          }}
          title={`${formatTokens(estimate.cacheHitTokens)} hit tokens`}
        />
        <div className="flex-1" style={{ background: 'var(--cache-miss)' }} title={`${formatTokens(estimate.cacheMissTokens)} miss tokens`} />
      </div>

      {!compact && plan.warnings.length > 0 ? (
        <ul className="mt-2.5 space-y-1">
          {plan.warnings.slice(0, 3).map((warning) => (
            <li key={warning} className="flex items-start gap-1.5 text-[11px] leading-snug text-warn">
              <span className="mt-0.5 shrink-0">
                <IconAlert size={11} />
              </span>
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
