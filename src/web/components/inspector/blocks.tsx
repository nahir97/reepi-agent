/**
 * The payload report: what the request is made of, and what each part costs.
 *
 * It lives in `dialogs/payload.tsx` now, opened from the composer's cache pill —
 * the control that measures the request is the control that explains it. The
 * `Warm cache` and `Re-measure` buttons it used to carry are gone from here: the
 * composer re-measures on every change, and warming has its own rows in Settings
 * and the command palette. A report is allowed to be a report.
 */

import { useState } from 'react';
import { formatTokens } from '../../../shared/cost.ts';
import { BLOCK_LABELS } from '../../../shared/types.ts';
import type { BlockKind } from '../../../shared/types.ts';
import { useStore } from '../../store.ts';
import { Card, SectionTitle } from '../panel.tsx';
import { IconAlert, IconChevronDown, IconSpark } from '../icons.tsx';

const VOLATILITY_LABEL: Record<0 | 1 | 2 | 3, string> = {
  0: 'frozen',
  1: 'rarely changes',
  2: 'sometimes changes',
  3: 'changes most turns',
};

const VOLATILITY_COLOR: Record<0 | 1 | 2 | 3, string> = {
  0: 'var(--cache-hit)',
  1: 'var(--accent)',
  2: 'var(--warn)',
  3: 'var(--cache-miss)',
};

/* ------------------------------------------------------------------ blocks */

export function BlocksTab() {
  const bundle = useStore((state) => state.bundle);
  const plan = useStore((state) => state.plan);
  const [open, setOpen] = useState<BlockKind | null>(null);

  if (!bundle) return null;

  if (!plan) {
    return (
      <p className="text-[12px] leading-snug text-faint">
        No payload measured yet. The meter fills in as soon as the composer has a story and a scene.
      </p>
    );
  }

  const share = plan.totalTokens > 0 ? plan.totalTokens : 1;

  return (
    <div>
      {plan.warnings.length > 0 ? (
        <Card>
          <SectionTitle title="Warnings" hint={`${plan.warnings.length}`} />
          <ul className="space-y-1.5">
            {plan.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-warn">
                <span className="mt-0.5 shrink-0">
                  <IconAlert size={11} />
                </span>
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {plan.advice.length > 0 ? (
        <Card>
          <SectionTitle title="Advice" hint={`${plan.advice.length} suggestions`} />
          <ul className="space-y-1.5">
            {plan.advice.map((tip) => (
              <li key={tip} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-dim">
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }}>
                  <IconSpark size={11} />
                </span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="Payload" hint={`${plan.messages} messages · ${formatTokens(plan.totalTokens)} tok`} />
        <ul className="space-y-1.5">
          {plan.blocks.map((block) => {
            const volatility = block.volatility;
            const width = Math.max(0.6, (block.tokens / share) * 100);
            return (
              <li key={block.kind}>
                <button
                  type="button"
                  className="w-full rounded-md p-1.5 text-left row-hover"
                  onClick={() => setOpen(open === block.kind ? null : block.kind)}
                  aria-expanded={open === block.kind}
                >
                  <div className="flex items-center gap-2">
                    <span className={`transition-transform ${open === block.kind ? '' : '-rotate-90'}`}>
                      <IconChevronDown size={10} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                      {block.label || BLOCK_LABELS[block.kind]}
                    </span>
                    {block.macros.length > 0 ? (
                      <span
                        className="chip shrink-0"
                        style={{ color: 'var(--accent)', borderColor: 'var(--border)' }}
                        title={`Resolved from the story every turn: ${block.macros.map((name) => `{{${name}}}`).join(', ')}`}
                      >
                        {block.macros.slice(0, 2).map((name) => `{{${name}}}`).join(' ')}
                        {block.macros.length > 2 ? ` +${block.macros.length - 2}` : ''}
                      </span>
                    ) : null}
                    {block.changed ? (
                      <span className="chip chip-miss" title="Hash moved since the previous turn — this and everything after it re-pays at the miss price">
                        changed
                      </span>
                    ) : null}
                    <span
                      className="chip"
                      style={{ color: VOLATILITY_COLOR[volatility], borderColor: 'var(--border)' }}
                      title={`Volatility ${volatility}: ${VOLATILITY_LABEL[volatility]}`}
                    >
                      vol {volatility}
                    </span>
                    <span className="num w-12 text-right text-[10.5px] text-dim">{formatTokens(block.tokens)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 pl-5">
                    <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-sunken)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${width}%`, background: VOLATILITY_COLOR[volatility] }}
                      />
                    </div>
                    <span className="num w-[5.5rem] text-right text-[10px] text-faint">
                      prefix {formatTokens(block.stablePrefixTokens)}
                    </span>
                  </div>
                </button>
                {open === block.kind ? (
                  <div className="mt-1.5 mb-1 ml-5">
                    <div className="eyebrow mb-1">Exact text in the payload (escaped)</div>
                    <pre
                      className="max-h-64 overflow-auto rounded-md border border-border p-2 text-[10.5px] leading-relaxed whitespace-pre-wrap break-words"
                      style={{ background: 'var(--bg-sunken)' }}
                    >
                      {block.preview || '(empty)'}
                    </pre>
                    <p className="num mt-1 text-[10px] text-faint">hash {block.hash}</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {plan.loreHits.length > 0 ? (
        <Card>
          <SectionTitle title="Lore fired this turn" hint={`${plan.loreHits.length} of ${bundle.lore.length}`} />
          <ul className="space-y-1.5">
            {plan.loreHits.map((hit) => (
              <li key={`${hit.entryId}-${hit.position}-${hit.depth}`} className="text-[11.5px] leading-snug">
                <span className="num mr-1.5" style={{ color: 'var(--accent)' }}>
                  {formatTokens(hit.tokens)}t
                </span>
                <span className="font-medium">{hit.title}</span>
                <span className="text-faint">
                  {' '}
                  · {hit.position}
                  {hit.position === 'depth' ? ` @${hit.depth}` : ''} · {hit.reason} · score {hit.score.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {plan.retrieval.length > 0 ? (
        <Card>
          <SectionTitle title="Recalled memories" hint={`${plan.retrieval.length}`} />
          <ul className="space-y-1.5">
            {plan.retrieval.map((item) => (
              <li key={item.memoryId} className="text-[11.5px] leading-snug text-dim">
                <span className="num mr-1.5 text-faint">{item.score.toFixed(2)}</span>
                {item.text}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="mt-2 text-[10.5px] leading-snug text-faint">
        Measuring is a dry run. It builds the exact request and reports what it would cost, and spends nothing.
        The composer re-measures as you write, so this report is always the next turn's.
      </p>
    </div>
  );
}
