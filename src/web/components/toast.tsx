/**
 * Stacked toasts. API failures carry the server's own `detail` verbatim — that
 * is usually the actual DeepSeek message, and hiding it would make debugging a
 * failed turn guesswork.
 */

import { useStore } from '../store.ts';
import { IconAlertCircle, IconCheckCircle, IconClose, IconGlobe } from './icons.tsx';

export function Toasts() {
  const toasts = useStore((state) => state.ui.toasts);
  const dismiss = useStore((state) => state.dismissToast);
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex flex-col items-center gap-2 p-3 pb-safe sm:inset-x-auto sm:right-4 sm:items-end"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
          className="animate-rise pointer-events-auto flex w-full max-w-[380px] items-start gap-2.5 rounded-lg border p-3 backdrop-blur-md"
          style={{
            background: 'color-mix(in oklab, var(--panel-raised) 92%, transparent)',
            borderColor:
              toast.kind === 'error'
                ? 'color-mix(in oklab, var(--danger) 45%, var(--border))'
                : toast.kind === 'ok'
                  ? 'color-mix(in oklab, var(--ok) 40%, var(--border))'
                  : 'var(--border)',
            boxShadow: 'var(--shadow-2)',
          }}
        >
          <span
            className="mt-0.5 shrink-0"
            style={{
              color:
                toast.kind === 'error' ? 'var(--danger)' : toast.kind === 'ok' ? 'var(--ok)' : 'var(--accent)',
            }}
          >
            {toast.kind === 'error' ? (
              <IconAlertCircle size={15} />
            ) : toast.kind === 'ok' ? (
              <IconCheckCircle size={15} />
            ) : (
              <IconGlobe size={15} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] leading-snug font-semibold">{toast.title}</p>
            {toast.detail ? (
              <p className="mt-0.5 text-[11.5px] leading-snug break-words text-dim">{toast.detail}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-btn -mt-0.5 -mr-0.5 shrink-0"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
