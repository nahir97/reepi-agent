/**
 * The macro reference, as two controls: a list you insert from, and a line that
 * reports what a piece of text already uses.
 *
 * Macros are the half of templating that has to be *discoverable*. A writer who
 * cannot see that `{{persona}}` exists will hand-write a description into a block
 * and then wonder why it goes stale, so the reference shows every macro with the
 * value it resolves to for the story that is open right now — not a generic
 * example. Those values come from the server's own resolver, which is the same one
 * the payload uses.
 *
 * The menu is **inline**, not floating. The surfaces that host it scroll (the tall
 * story-settings body, the template editor), and an absolutely positioned panel
 * inside a scroll container is either clipped or torn out of the flow; the story
 * rows solved that with `position: fixed` and a measured anchor, which is more
 * machinery than a reference list needs. Inline costs a couple of rows of layout
 * and cannot be clipped at any width.
 */

import { useEffect, useState } from 'react';
import { MACRO_GROUPS, macroTokens } from '../../shared/macros.ts';
import type { MacroInfo } from '../../shared/api.ts';
import { IconChevronDown, IconClose } from './icons.tsx';

/* ------------------------------------------------------------------ insertion */

/** One-line form of a resolved value, for a chip or a list row. */
export function summariseMacro(value: string, limit = 72): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return '(empty)';
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

/**
 * Splice a token into a field's text.
 *
 * `atCaret` is the host's answer to "did the writer last put the caret in *this*
 * field?". It has to be asked because clicking the menu button blurs the textarea:
 * the caret survives, but nothing about the DOM says whether the writer was ever
 * in this field at all — and a textarea that has never been focused reports its
 * caret at position 0, which would silently *prepend* the token to the end of a
 * block the writer was reading. So a field that was not just in use gets the token
 * appended, and a field that was gets it exactly where the caret is.
 *
 * Returned rather than applied because every host keeps its value in React state:
 * the caller sets the value and restores the caret, which is why the caret offset
 * comes back with the text.
 */
export function insertMacro(
  field: HTMLTextAreaElement | null,
  current: string,
  token: string,
  atCaret: boolean,
): { value: string; caret: number } {
  if (!field || !atCaret) {
    const value = current.trim() ? `${current} ${token}` : token;
    return { value, caret: value.length };
  }
  const start = field.selectionStart ?? current.length;
  const end = field.selectionEnd ?? start;
  const value = `${current.slice(0, start)}${token}${current.slice(end)}`;
  return { value, caret: start + token.length };
}

/* --------------------------------------------------------------- the picker */

export function MacroPicker({
  macros,
  onInsert,
  disabled = false,
}: {
  macros: MacroInfo[];
  onInsert: (token: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const storyOpen = macros.some((macro) => macro.value !== null);

  return (
    <div className="min-w-0">
      <button
        type="button"
        className="chip flex items-center gap-1"
        style={{ borderColor: 'var(--border)' }}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        title="Insert a macro that resolves against this story"
      >
        <span className="text-dim">Macros</span>
        <span className="text-faint">
          <IconChevronDown size={9} />
        </span>
      </button>

      {open ? (
        <div
          className="mt-1.5 rounded-lg border border-border p-2"
          style={{ background: 'var(--bg-sunken)' }}
          aria-label="Macro reference"
        >
          <div className="mb-1.5 flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[10.5px] leading-snug text-faint">
              {storyOpen
                ? 'Values below are resolved for the open story — they are re-read on every turn, never saved into the text.'
                : 'Open a story to see resolved values. The tokens work regardless.'}
            </p>
            <button
              type="button"
              className="shrink-0 text-faint hover:text-dim"
              onClick={() => setOpen(false)}
              aria-label="Close the macro reference"
            >
              <IconClose size={11} />
            </button>
          </div>

          <div className="max-h-[min(22rem,50vh)] space-y-2 overflow-y-auto">
            {MACRO_GROUPS.map((group) => {
              const rows = macros.filter((macro) => macro.group === group);
              if (rows.length === 0) return null;
              return (
                <div key={group}>
                  <div className="eyebrow mb-1">{group}</div>
                  <ul className="space-y-0.5">
                    {rows.map((macro) => (
                      <li key={macro.name}>
                        <button
                          type="button"
                          className="w-full rounded-md px-1.5 py-1 text-left row-hover"
                          onClick={() => onInsert(`{{${macro.name}}}`)}
                          title={macro.hint}
                        >
                          <span className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className="num text-[11px]" style={{ color: 'var(--accent)' }}>
                              {`{{${macro.name}}}`}
                            </span>
                            <span className="text-[11px] text-dim">{macro.label}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[10.5px] text-faint">
                            {macro.value === null ? macro.hint : summariseMacro(macro.value)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- the read-out */

/**
 * What a block's text uses: each macro with the value it will carry, and any
 * unknown token called out — an unknown name is left verbatim in the payload, so
 * a typo would otherwise reach the model as `{{personna}}`.
 */
export function MacroLine({ macros, text }: { macros: MacroInfo[]; text: string }) {
  const tokens = macroTokens(text);
  if (tokens.length === 0) return null;

  const seen = new Set<string>();
  const rows: { token: string; known: boolean; value: string | null }[] = [];
  for (const token of tokens) {
    if (seen.has(token.name)) continue;
    seen.add(token.name);
    rows.push({
      token: `{{${token.name}}}`,
      known: token.known,
      value: token.known ? (macros.find((macro) => macro.name === token.name)?.value ?? null) : null,
    });
  }

  return (
    <p className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px] leading-snug text-faint">
      {rows.map((row) => (
        <span
          key={row.token}
          className="chip max-w-full min-w-0"
          style={{ borderColor: row.known ? 'var(--border)' : 'var(--warn)', color: row.known ? undefined : 'var(--warn)' }}
          title={
            row.known
              ? row.value === null
                ? 'Resolved from the story each turn — never stored in this text'
                : `${row.token} → ${summariseMacro(row.value, 200)}`
              : 'Not a macro this build knows: it will be sent exactly as typed'
          }
        >
          <span className="num shrink-0">{row.token}</span>
          {/* The value is ellipsised rather than left to wrap or push: a chip is
              nowrap, and a persona description is long enough to widen a phone
              layout on its own. The full text is the chip's title. */}
          {row.known ? (
            <span className="ml-1 min-w-0 truncate text-faint">
              {row.value === null ? '' : summariseMacro(row.value, 42)}
            </span>
          ) : (
            <span className="ml-1">unknown</span>
          )}
        </span>
      ))}
    </p>
  );
}
