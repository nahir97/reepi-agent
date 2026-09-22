/**
 * The dialog shell: focus trap, outer frame, and the shared block-edit warning.
 *
 * `useDialogA11y` and `Shell` are what every dialog in this directory is built
 * from, so the keyboard behaviour and the surrounding markup exist once instead of
 * once per dialog. `blockWarning` sits here too: the volatility wording is the
 * cache argument in plain language, quoted wherever a block is edited, and it is
 * the reason this module depends on the cost model and nothing else.
 *
 * Nothing here reads the store — these are pure presentation seams, which is what
 * lets a dialog own its own state without owning the frame around it.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { formatTokens } from '../../../shared/cost.ts';
import { BLOCK_VOLATILITY } from '../../../shared/types.ts';
import type { BlockKind } from '../../../shared/types.ts';
import { IconClose } from '../icons.tsx';

/* ------------------------------------------------------------- focus trap */

/**
 * Traps focus inside the dialog and closes on Escape.
 *
 * The effect is keyed on `open` and the initial-focus selector — never on the
 * `onClose` callback, and that is load-bearing rather than tidy. Callers pass a
 * fresh `onClose` arrow on every render, so depending on it tore the trap down and
 * rebuilt it on *every keystroke*: the cleanup restored focus to whatever had been
 * focused when the last run started, and the setup then focused the dialog's first
 * control. One character typed into a field therefore moved focus to the header's
 * close button — on a phone that dismisses the on-screen keyboard mid-word, and the
 * next keypress would have activated the button. The latest callback is read from a
 * ref instead, and the first control is focused once, when the dialog opens.
 */
export function useDialogA11y<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  /** Selector for the control that should take focus when the dialog opens. */
  initialFocus?: string,
) {
  const ref = useRef<T | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = (): HTMLElement[] =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => element.offsetParent !== null)
        : [];

    /* `initialFocus` is explicit rather than inferred from `autoFocus`, because a
       React autofocus is applied during commit and would otherwise be overridden
       one tick later by the line below — which is how the close button came to be
       the focused control in every dialog, the new-story title field included. */
    const preferred = initialFocus && node ? node.querySelector<HTMLElement>(initialFocus) : null;
    const first = preferred ?? focusable()[0];
    if (first) first.focus();
    else node?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }
      /* Queried per keypress, so the cycle picks up controls that appear or
         disappear while the dialog is open. */
      if (event.key !== 'Tab') return;
      const items = focusable();
      const head = items[0];
      const tail = items[items.length - 1];
      if (!head || !tail) return;
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, [open, initialFocus]);

  return ref;
}

/* ------------------------------------------------------------------ shell */

export function Shell({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
  initialFocus,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Selector for the control to focus on open. Defaults to the first one. */
  initialFocus?: string;
}) {
  const ref = useDialogA11y<HTMLDivElement>(true, onClose, initialFocus);
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`animate-rise flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-border sm:rounded-xl ${
          wide ? 'sm:max-w-[54rem]' : 'sm:max-w-[38rem]'
        }`}
        style={{ background: 'var(--panel-raised)', boxShadow: 'var(--shadow-3)' }}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-[16px] leading-tight font-semibold">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[11.5px] leading-snug text-faint">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn ml-auto shrink-0" onClick={onClose} aria-label="Close dialog">
            <IconClose size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? (
          <footer className="pb-safe flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- block warning */

/** Plain-language consequence of editing a block, by volatility. */
export function blockWarning(kind: BlockKind, tokens: number): string {
  const volatility = BLOCK_VOLATILITY[kind];
  if (volatility === 0) {
    return `Frozen block. It sits at the very front of the payload, so editing it invalidates the whole prefix behind it — every token of the request re-pays at the miss price.`;
  }
  if (volatility === 1) {
    return `Almost frozen. ${formatTokens(tokens)} tokens of prose edits are usually permanent, which is exactly why they should be made now rather than in fifty turns' time.`;
  }
  if (volatility === 2) {
    return `Sits mid-payload. A change here invalidates this block and everything after it — the transcript included.`;
  }
  return `Volatile by design: it lives in the tail, so a change costs only its own tokens.`;
}
