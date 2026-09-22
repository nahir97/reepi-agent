/**
 * The cost instrument panel.
 *
 * This is the product's soul laid out on one screen: what was spent, what the
 * cache saved, what a naive client would have paid, and whether right now is a
 * good moment to spend anything at all.
 *
 * Every figure comes from the server's `Insights`. Nothing is computed
 * client-side except the live countdown, which is a clock, not a measurement.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  cacheMultiplier,
  formatCountdown,
  formatDuration,
  formatPercent,
  formatTokens,
  formatUsd,
  hitRate,
  isPeak,
  msUntilOffPeak,
} from '../../shared/cost.ts';
import { MODELS } from '../../shared/types.ts';
import type { CostEventKind, ModelId } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { SectionTitle } from './panel.tsx';
import {
  IconAlert,
  IconChart,
  IconCheckCircle,
  IconClock,
  IconFlame,
  IconGauge,
  IconRefresh,
  IconSnow,
  IconWarm,
} from './icons.tsx';

const KIND_LABEL: Record<CostEventKind, string> = {
  narration: 'Narration',
  director: 'Director',
  archivist: 'Archivist',
  summarise: 'Summariser',
  conductor: 'Conductor',
  judge: 'Judge',
};

const KIND_COLOR: Record<CostEventKind, string> = {
  narration: 'var(--accent)',
  director: 'var(--cache-hit)',
  archivist: 'var(--narrator)',
  summarise: 'var(--text-dim)',
  conductor: 'var(--warn)',
  judge: 'var(--danger)',
};

export function Insights() {
  const insights = useStore((state) => state.insights);
  const account = useStore((state) => state.account);
  const diagnose = useStore((state) => state.diagnose);
  const warmup = useStore((state) => state.warmup);
  const busy = useStore((state) => state.busy);
  const activeStoryId = useStore((state) => state.activeStoryId);
  const refreshInsights = useStore((state) => state.refreshInsights);
  const refreshAccount = useStore((state) => state.refreshAccount);
  const runDiagnose = useStore((state) => state.runDiagnose);
  const runWarm = useStore((state) => state.runWarm);

  if (!insights) {
    return (
      <div className="p-4">
        <p className="text-[12px] text-faint">
          Nothing recorded yet. Costs appear as soon as a turn lands — every figure here comes from the provider's own
          usage report, not from an estimate.
        </p>
      </div>
    );
  }

  const { totals, projection } = insights;
  const model = insights.byModel[0]?.model ?? 'deepseek-flash';
  const multiplier = cacheMultiplier(model, insights.peak);
  const naiveDelta = Math.max(0, projection.naivePer100TurnsUsd - projection.per100TurnsUsd);

  return (
    <div className="space-y-3 p-3">
      {/* --------------------------------------------------------- headline */}

      <div>
        <SectionTitle title="The ledger" hint={activeStoryId ? 'this story' : 'every story'} />
        <div className="grid grid-cols-2 gap-2">
          <Big label="Total spend" value={formatUsd(totals.costUsd)} tone="var(--accent)" />
          <Big label="Saved by cache" value={formatUsd(totals.savedUsd)} tone="var(--ok)" />
          <Big
            label="Realised hit rate"
            value={formatPercent(totals.hitRate)}
            tone={totals.hitRate >= 0.7 ? 'var(--cache-hit)' : 'var(--cache-miss)'}
          />
          <Big label="Cache multiplier" value={`${multiplier.toFixed(0)}×`} tone="var(--warn)" hint="a miss costs this many times a hit" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Small label="Words written" value={formatTokens(totals.wordsWritten)} />
        <Small label="Requests" value={String(totals.requests)} />
        <Small label="Hit tokens" value={formatTokens(totals.cacheHitTokens)} tone="var(--cache-hit)" />
        <Small label="Miss tokens" value={formatTokens(totals.cacheMissTokens)} tone="var(--cache-miss)" />
        <Small label="Output tokens" value={formatTokens(totals.outputTokens)} />
        <Small label="Reasoning tokens" value={formatTokens(totals.reasoningTokens)} />
      </div>

      {/* ------------------------------------------------------ peak clock */}

      <PeakClock peak={insights.peak} msUntil={insights.msUntilOffPeak} activeStory={Boolean(activeStoryId)} />

      {/* ------------------------------------------------------- projection */}

      <div className="card p-3">
        <SectionTitle title="Projection" hint="at the realised rates above" />
        <div className="grid grid-cols-3 gap-2">
          <Small label="Per turn" value={formatUsd(projection.perTurnUsd)} />
          <Small label="Per 100 turns" value={formatUsd(projection.per100TurnsUsd)} />
          <Small label="Per 1k words" value={formatUsd(projection.per1kWordsUsd)} />
        </div>
        <div className="mt-2.5 rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
          <div className="eyebrow mb-1">Versus a client that never caches</div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="num text-[15px] font-semibold" style={{ color: 'var(--cache-miss)' }}>
              {formatUsd(projection.naivePer100TurnsUsd)}
            </span>
            <span className="text-[11.5px] text-faint">naive · 100 turns</span>
            <span className="text-faint" aria-hidden="true">
              →
            </span>
            <span className="num text-[15px] font-semibold" style={{ color: 'var(--cache-hit)' }}>
              {formatUsd(projection.per100TurnsUsd)}
            </span>
            <span className="text-[11.5px] text-faint">this studio</span>
            {naiveDelta > 0 ? (
              <span className="chip chip-hit">
                {formatPercent(projection.naivePer100TurnsUsd > 0 ? naiveDelta / projection.naivePer100TurnsUsd : 0)} cheaper
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full border border-border">
            <div
              style={{
                width: `${projection.naivePer100TurnsUsd > 0 ? Math.max(0.5, (projection.per100TurnsUsd / projection.naivePer100TurnsUsd) * 100) : 0}%`,
                background: 'var(--cache-hit)',
              }}
              title={`${formatUsd(projection.per100TurnsUsd)} — the studio's rate`}
            />
            <div className="flex-1" style={{ background: 'var(--cache-miss)' }} title={`${formatUsd(naiveDelta)} given away per 100 turns`} />
          </div>
          <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
            The red band is what a cache-blind client burns in the same hundred turns. That difference is the entire
            product.
          </p>
        </div>
      </div>

      {/* -------------------------------------------------------- sparkline */}

      <div className="card p-3">
        <SectionTitle
          title="Recent spend"
          hint={`${insights.timeline.length} recorded calls`}
          action={
            <button
              type="button"
              className="icon-btn"
              aria-label="Refresh the ledger"
              onClick={() => void refreshInsights()}
            >
              <IconRefresh size={12} />
            </button>
          }
        />
        <Sparkline points={insights.timeline} />
        {insights.last ? (
          <p className="num mt-2 text-[10.5px] text-faint">
            Last: {KIND_LABEL[insights.last.kind]} · {formatUsd(insights.last.costUsd)} ·{' '}
            {formatPercent(hitRate(insights.last))} cached
            {insights.last.peak ? ' · peak 2×' : ' · off-peak'}
          </p>
        ) : null}
      </div>

      {/* -------------------------------------------------------- breakdown */}

      <div className="card p-3">
        <SectionTitle title="By kind" hint="narration is the one that has to be cheap" />
        <ul className="space-y-1.5">
          {insights.byKind.map((row) => (
            <li key={row.kind} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[row.kind] }} />
              <span className="w-20 shrink-0 text-[11.5px]">{KIND_LABEL[row.kind]}</span>
              <span className="num min-w-0 flex-1 text-right text-[11px] text-dim">{formatUsd(row.costUsd)}</span>
              <span className="num w-10 shrink-0 text-right text-[10.5px] text-faint">{row.requests}×</span>
              <span
                className="num w-11 shrink-0 text-right text-[10.5px]"
                style={{ color: row.hitRate >= 0.7 ? 'var(--cache-hit)' : 'var(--cache-miss)' }}
              >
                {formatPercent(row.hitRate)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-3">
        <SectionTitle title="By model" />
        <ul className="space-y-1.5">
          {insights.byModel.map((row) => (
            <li key={row.model} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[11.5px]">{MODELS[row.model as ModelId]?.label ?? row.model}</span>
              <span className="num text-[11px] text-dim">{formatUsd(row.costUsd)}</span>
              <span className="num w-10 text-right text-[10.5px] text-faint">{row.requests}×</span>
              <span className="num w-11 text-right text-[10.5px]" style={{ color: row.hitRate >= 0.7 ? 'var(--cache-hit)' : 'var(--cache-miss)' }}>
                {formatPercent(row.hitRate)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ------------------------------------------------------------ warm */}

      <div className="card p-3">
        <SectionTitle
          title="Cache warm-up"
          hint={insights.warmup ? `warmed ${new Date(insights.warmup.warmedAt).toLocaleString()}` : 'never warmed'}
          action={
            <button
              type="button"
              className="btn"
              style={{ padding: '0.25rem 0.5rem' }}
              disabled={!activeStoryId || busy === 'warm'}
              onClick={() => void runWarm()}
              title="Send the current prefix twice with a tiny completion, so every later turn rides a live cache unit"
            >
              <IconWarm size={11} />
              {busy === 'warm' ? 'Warming…' : 'Warm cache'}
            </button>
          }
        />
        {insights.warmup ? (
          <p className="num text-[11px] text-dim">
            {formatTokens(insights.warmup.tokens)} tokens warm · cost {formatUsd(insights.warmup.costUsd)} · fingerprint{' '}
            {insights.warmup.fingerprint}
          </p>
        ) : (
          <p className="text-[11.5px] leading-snug text-faint">
            A freshly edited prefix is cold: the next few turns all pay the miss price. Warming pays that once,
            deliberately, and confirms it with a second identical request.
          </p>
        )}
        {warmup ? (
          <div className="mt-2.5 rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
            <div className="eyebrow mb-1.5">
              Before → after {warmup.confirmedHit ? '· hit confirmed' : '· no hit observed'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <PassRow label="First pass" hit={warmup.firstPass.cacheHitTokens} miss={warmup.firstPass.cacheMissTokens} ttft={warmup.firstPass.ttftMs} />
              <PassRow label="Second pass" hit={warmup.secondPass.cacheHitTokens} miss={warmup.secondPass.cacheMissTokens} ttft={warmup.secondPass.ttftMs} />
            </div>
            <p className="num mt-2 text-[10.5px] text-faint">
              {formatTokens(warmup.tokens)} tokens · paid {formatUsd(warmup.costUsd)} · fingerprint {warmup.fingerprint}
            </p>
          </div>
        ) : null}
      </div>

      {/* ----------------------------------------------------------- account */}

      <div className="card p-3">
        <SectionTitle
          title="Account"
          action={
            <button type="button" className="icon-btn" aria-label="Refresh the balance" onClick={() => void refreshAccount()}>
              <IconRefresh size={12} />
            </button>
          }
        />
        {account ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="num text-[19px] font-semibold">
                {account.balanceUsd === null ? '—' : formatUsd(account.balanceUsd)}
              </span>
              <span className="text-[11px] text-faint">on the key</span>
              {account.available ? <span className="chip chip-hit">available</span> : <span className="chip chip-miss">unavailable</span>}
            </div>
            {!account.keyPresent ? (
              <p className="mt-1.5 text-[11.5px] leading-snug" style={{ color: 'var(--danger)' }}>
                No DEEPSEEK_API_KEY on the server. Set it in <span className="num">.env</span> and restart the API.
              </p>
            ) : null}
            <p className="num mt-1.5 text-[10.5px] text-faint">
              calibration {account.calibration.factor.toFixed(3)}× from {account.calibration.samples} samples
              {account.calibration.samples > 0
                ? ` — token previews are this close to the provider's own count`
                : ' — no samples yet, so previews are raw estimates'}
            </p>
            {account.models.length > 0 ? (
              <p className="num mt-1 text-[10.5px] text-faint">models on the key: {account.models.join(', ')}</p>
            ) : null}
          </>
        ) : (
          <p className="text-[11.5px] text-faint">Balance not loaded yet.</p>
        )}
      </div>

      {/* ---------------------------------------------------------- diagnose */}

      <div className="card p-3">
        <SectionTitle
          title="Diagnose"
          hint="live checks, no narration spend"
          action={
            <button
              type="button"
              className="btn"
              style={{ padding: '0.25rem 0.5rem' }}
              disabled={busy === 'diagnose'}
              onClick={() => void runDiagnose()}
            >
              <IconGauge size={11} />
              {busy === 'diagnose' ? 'Running…' : 'Run Diagnose'}
            </button>
          }
        />
        {!diagnose ? (
          <p className="text-[11.5px] leading-snug text-faint">
            Checks the key, the model list, the payload order and the cache itself. The cache smoke test sends one tiny
            request twice and reads the provider's own hit accounting.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {diagnose.checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2">
                  <span
                    className="mt-0.5 shrink-0"
                    style={{
                      color:
                        check.level === 'pass' ? 'var(--ok)' : check.level === 'warn' ? 'var(--warn)' : 'var(--danger)',
                    }}
                  >
                    {check.level === 'pass' ? <IconCheckCircle size={12} /> : <IconAlert size={12} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] leading-snug font-medium">{check.label}</p>
                    <p className="text-[11px] leading-snug text-dim">{check.detail}</p>
                    {check.fix ? (
                      <p className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--accent)' }}>
                        Fix: {check.fix}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            {diagnose.cacheSmoke ? (
              <div className="mt-2.5 rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
                <div className="eyebrow mb-1.5">Cache smoke test</div>
                {diagnose.cacheSmoke.ran ? (
                  <>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="num text-[15px] font-semibold" style={{ color: diagnose.cacheSmoke.hitRate >= 0.5 ? 'var(--cache-hit)' : 'var(--cache-miss)' }}>
                        {formatPercent(diagnose.cacheSmoke.hitRate)}
                      </span>
                      <span className="text-[11px] text-faint">
                        {formatTokens(diagnose.cacheSmoke.hitTokens)} hit / {formatTokens(diagnose.cacheSmoke.missTokens)} miss
                      </span>
                      <span className="num text-[11px] text-faint">
                        {formatDuration(diagnose.cacheSmoke.firstMs)} → {formatDuration(diagnose.cacheSmoke.secondMs)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-snug text-dim">{diagnose.cacheSmoke.verdict}</p>
                  </>
                ) : (
                  <p className="text-[11.5px] leading-snug text-faint">{diagnose.cacheSmoke.verdict}</p>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

      <p className="pb-2 text-[10.5px] leading-snug text-faint">
        Money is reported as the provider bills it. Nothing in this panel is rounded before it is displayed, and the
        ledger is written by the server, never by the client.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- primitives */


function Big({ label, value, tone, hint }: { label: string; value: string; tone: string; hint?: string }) {
  return (
    <div className="card p-2.5" title={hint}>
      <div className="eyebrow">{label}</div>
      <div className="num mt-1 text-[19px] leading-none font-semibold" style={{ color: tone }}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-[10px] leading-snug text-faint">{hint}</div> : null}
    </div>
  );
}

function Small({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <div className="eyebrow">{label}</div>
      <div className="num mt-0.5 text-[12.5px]" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

function PassRow({
  label,
  hit,
  miss,
  ttft,
}: {
  label: string;
  hit: number;
  miss: number;
  ttft: number | null;
}) {
  const total = hit + miss;
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="num mt-0.5 text-[11px]">
        {total > 0 ? formatPercent(hit / total) : '—'} cached
      </div>
      <div className="num text-[10px] text-faint">
        {formatTokens(hit)}/{formatTokens(miss)} · {ttft === null ? 'no ttft' : formatDuration(ttft)}
      </div>
    </div>
  );
}

/**
 * The peak clock. Peak windows are 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri, and
 * they bill at exactly 2×. The countdown is a live clock rather than a stored
 * figure, so it is the one number this panel derives locally.
 */
function PeakClock({ peak, msUntil, activeStory }: { peak: boolean; msUntil: number; activeStory: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const live = isPeak(now);
  const remaining = live ? msUntilOffPeak(now) : msUntil;

  return (
    <div
      className="card p-3"
      style={{
        borderColor: live ? 'color-mix(in oklab, var(--danger) 40%, var(--border))' : 'color-mix(in oklab, var(--ok) 35%, var(--border))',
        background: live ? 'color-mix(in oklab, var(--danger) 6%, var(--panel))' : 'var(--panel)',
      }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0" style={{ color: live ? 'var(--danger)' : 'var(--ok)' }}>
          {live ? <IconFlame size={15} /> : <IconSnow size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="eyebrow" style={{ color: live ? 'var(--danger)' : 'var(--ok)' }}>
              {live ? 'Peak — double price' : 'Off-peak — half price'}
            </span>
            <span className="num text-[13px] font-semibold">{live ? formatCountdown(remaining) : 'now'}</span>
            {live ? <span className="text-[10.5px] text-faint">until half price returns</span> : null}
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-dim">
            {live
              ? activeStory
                ? 'Every token you spend right now costs twice what it will in a few hours. Defer anything long — a fifty-turn session, an Archivist sweep, a batch of conductor variants — and warm the prefix after the window closes.'
                : 'Everything bills at 2× until this window ends.'
              : 'Prices are at their floor. This is the window to warm a prefix, run the Archivist, or write a long session.'}
          </p>
          <div className="mt-1.5 flex gap-3 text-[10.5px] text-faint">
            <span className="flex items-center gap-1">
              <IconClock size={10} />
              <span className="num">01:00–04:00 UTC</span>
            </span>
            <span className="flex items-center gap-1">
              <IconClock size={10} />
              <span className="num">06:00–10:00 UTC</span>
            </span>
            <span>Mon–Fri · weekends are always off-peak</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline SVG sparkline: cost as bars, hit rate as a line over the same x axis.
 * Two series, one picture — the point is that they move together.
 */
function Sparkline({ points }: { points: { at: number; costUsd: number; hitRate: number; kind: CostEventKind }[] }) {
  const geometry = useMemo(() => {
    const recent = points.slice(-60);
    if (recent.length === 0) return null;
    const width = 320;
    const height = 72;
    const maxCost = Math.max(...recent.map((point) => point.costUsd), 0.0001);
    const step = width / recent.length;
    const barWidth = Math.max(1.2, Math.min(9, step * 0.62));
    const bars = recent.map((point, index) => ({
      x: index * step + (step - barWidth) / 2,
      h: Math.max(1, (point.costUsd / maxCost) * (height - 18)),
      cost: point.costUsd,
      kind: point.kind,
      at: point.at,
      barWidth,
    }));
    const last = recent[recent.length - 1] as { hitRate: number };
    const line = recent
      .map((point, index) => {
        const x = index * step + step / 2;
        const y = height - 14 - Math.min(1, Math.max(0, point.hitRate)) * (height - 24);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const dot = {
      x: (recent.length - 1) * step + step / 2,
      y: height - 14 - Math.min(1, Math.max(0, last.hitRate)) * (height - 24),
    };
    return { width, height, bars, line, dot, maxCost, count: recent.length };
  }, [points]);

  if (!geometry) {
    return <p className="text-[11.5px] text-faint">No calls recorded yet — the sparkline fills in with your first turn.</p>;
  }

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        width="100%"
        height={geometry.height}
        role="img"
        aria-label={`Cost and cache hit rate across the last ${geometry.count} calls. Peak cost ${formatUsd(geometry.maxCost)}.`}
        preserveAspectRatio="none"
      >
        {/* Baseline. */}
        <line
          x1={0}
          y1={geometry.height - 14}
          x2={geometry.width}
          y2={geometry.height - 14}
          stroke="var(--border)"
          strokeWidth={1}
        />
        {geometry.bars.map((bar) => (
          <rect
            key={`${bar.at}-${bar.x}`}
            x={bar.x}
            y={geometry.height - 14 - bar.h}
            width={bar.barWidth}
            height={bar.h}
            rx={1}
            fill={KIND_COLOR[bar.kind]}
            opacity={0.55}
          >
            <title>{`${KIND_LABEL[bar.kind]} · ${formatUsd(bar.cost)} · ${new Date(bar.at).toLocaleString()}`}</title>
          </rect>
        ))}
        <path d={geometry.line} fill="none" stroke="var(--cache-hit)" strokeWidth={1.6} strokeLinejoin="round" />
        <circle cx={geometry.dot.x} cy={geometry.dot.y} r={2.6} fill="var(--cache-hit)" />
      </svg>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded-sm" style={{ background: 'var(--accent)' }} />
          cost per call
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 rounded-sm" style={{ background: 'var(--cache-hit)' }} />
          cache hit rate
        </span>
        <span className="ml-auto flex items-center gap-1">
          <IconChart size={10} />
          last {geometry.count} · peak {formatUsd(geometry.maxCost)}
        </span>
      </figcaption>
    </figure>
  );
}
