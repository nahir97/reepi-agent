/**
 * The confirm dialog: one yes/no question, with the body and the callbacks the
 * caller supplies.
 *
 * It is deliberately generic — every destructive action goes through this single
 * component, so the wording lives at the call site and the button styling does
 * not. Separate because it is the only dialog that must never touch the store:
 * both callbacks arrive as props.
 */

import { Shell } from './shell.tsx';

/* ----------------------------------------------------------------- confirm */

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  run,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
  run: () => void;
  onClose: () => void;
}) {
  return (
    <Shell
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              run();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="text-[12.5px] leading-relaxed text-dim">{body}</p>
    </Shell>
  );
}
