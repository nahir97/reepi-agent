/**
 * Shared inspector tab infrastructure.
 *
 * `DraftField` is the one control several tabs lean on: a textarea that holds a
 * local draft and only commits when the writer asks it to. Kept here so the
 * blocks, scene and director tabs all behave identically.
 */

import { useEffect, useState } from 'react';
import { formatTokens } from '../../../shared/cost.ts';
import { estimateTokens, DEFAULT_CALIBRATION, countWords } from '../../../shared/tokens.ts';

/* ------------------------------------------------------------- primitives */



/** A labelled text field with a draft and an explicit commit. */
export function DraftField({
  id,
  label,
  value,
  rows = 3,
  hint,
  tokens,
  onCommit,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  rows?: number;
  hint?: string;
  tokens?: boolean;
  onCommit: (next: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(value);
  }, [value, dirty]);

  const estimated = tokens ? estimateTokens(draft, DEFAULT_CALIBRATION) : 0;

  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-baseline gap-2">
        <label className="label mb-0" htmlFor={id}>
          {label}
        </label>
        {tokens ? (
          <span className="num ml-auto text-[10px] text-faint">
            {formatTokens(estimated)} tok · {countWords(draft)}w
          </span>
        ) : null}
      </div>
      <textarea
        id={id}
        className="field mt-1 resize-y font-serif leading-relaxed"
        rows={rows}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => {
          setDraft(event.target.value);
          setDirty(true);
        }}
      />
      {hint ? <p className="mt-1 text-[10.5px] leading-snug text-faint">{hint}</p> : null}
      {dirty ? (
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '0.3rem 0.55rem' }}
            onClick={() => {
              onCommit(draft);
              setDirty(false);
            }}
          >
            Apply to payload
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.3rem 0.55rem' }}
            onClick={() => {
              setDraft(value);
              setDirty(false);
            }}
          >
            Revert
          </button>
        </div>
      ) : null}
    </div>
  );
}
