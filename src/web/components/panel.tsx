/**
 * Shared inspector primitives.
 *
 * These were duplicated verbatim in `Inspector.tsx` and `Insights.tsx`, which is
 * exactly the kind of copy that drifts: one gains a truncate class, the other does
 * not, and two panels that should look identical stop matching. One definition,
 * one appearance.
 *
 * `PageBand` joined them for the same reason once the studio had two full-column
 * pages (the cast roster and the creation assistant): a page's band is `.topbar`,
 * like every other column header, so the rule under it is one line across the
 * window — which only holds while there is one definition of it.
 */

import type { ReactNode } from 'react';
import { IconChevronLeft } from './icons.tsx';

/**
 * A page's header: the only way out, what the page is, and its own controls.
 *
 * The back control is the *only* way out, which is what makes a full-column page
 * printable rather than an overlay: a page needs no second close.
 */
export function PageBand({
  title,
  hint,
  onBack,
  actions,
}: {
  title: string;
  /** Context under the title. A node, not a string, so a page can drop the figure
      that does not fit a phone's band while keeping the sentence around it. */
  hint?: ReactNode;
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar pt-safe shrink-0 gap-2 border-b border-border px-3" style={{ background: 'var(--panel)' }}>
      <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to the story">
        <IconChevronLeft size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-[15px] leading-tight font-semibold">{title}</h1>
        {hint ? <p className="num truncate text-[10.5px] text-faint">{hint}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

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
