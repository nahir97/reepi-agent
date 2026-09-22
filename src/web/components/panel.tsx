/**
 * Shared inspector primitives.
 *
 * These were duplicated verbatim in `Inspector.tsx` and `Insights.tsx`, which is
 * exactly the kind of copy that drifts: one gains a truncate class, the other does
 * not, and two panels that should look identical stop matching. One definition,
 * one appearance.
 */

import type { ReactNode } from 'react';

/**
 * A section heading inside a panel: an eyebrow, an optional hint, an optional
 * trailing control.
 */
export function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <span className="eyebrow shrink-0">{title}</span>
      {hint ? <span className="min-w-0 truncate text-[10.5px] text-faint">{hint}</span> : null}
      {action ? <span className="ml-auto shrink-0">{action}</span> : null}
    </div>
  );
}

/** A raised card used for every row inside the inspector. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="card mb-2 p-2.5" style={{ background: 'var(--panel-raised)' }}>
      {children}
    </div>
  );
}

/** A labelled metric, tabular figures, optional tone. */
export function Metric({
  label,
  value,
  tone,
  hint,
  size = 'md',
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="eyebrow">{label}</div>
      <div
        className={`num mt-0.5 leading-tight ${size === 'sm' ? 'text-[12px]' : 'text-[13px]'}`}
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
