/**
 * The roleplay renderer.
 *
 * A hand-written, escape-free tokenizer. No raw-HTML injection anywhere in this
 * renderer, and no markdown library: the splitter is deliberately *lossless*, so
 * every character the model emitted ends up on screen exactly once, in order.
 * Unmatched delimiters degrade to literal text rather than eating prose.
 *
 * What it recognises, in priority order:
 *
 * - `((out of character))` — set apart, because OOC is a different register
 * - `**strong**`, `*emphasis*` — and `*pairs*` never span a paragraph
 * - `"spoken dialogue"` — the loudest ink on the page; in roleplay, dialogue is
 *   the point. Nested `"inner"` quotes and `'single'` dialogue are handled by
 *   boundary heuristics, so an apostrophe in `don't` is never a delimiter.
 * - a bare `---` line becomes a printer's ornament
 *
 * Line breaks inside a paragraph are preserved; blank lines separate paragraphs.
 */

import { Fragment, useMemo, type ReactNode } from 'react';

export type ProseProps = {
  text: string;
  /** Rendered as a streaming caret at the very end. */
  streaming?: boolean;
  className?: string;
  /** `{{user}}` / `{{char}}` replacement values. */
  macros?: Record<string, string>;
};

const SCENE_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,}|[—–]{2,}|•\s*•\s*•)\s*$/;

/** Word characters: an apostrophe touching these is a contraction, not a quote. */
const WORD = /[\p{L}\p{N}]/u;

/** Characters that may sit immediately outside a quotation mark. */
const OUTER = /[\s(\[«“‘—–-]/u;
const OUTER_END = /[\s)\]»”’,.;:!?—–-]/u;

type Span = { kind: 'text' | 'dialogue' | 'ooc'; value: string } | { kind: 'strong' | 'em'; value: string };

function isOpenQuote(text: string, index: number, mark: string): boolean {
  const next = text[index + mark.length];
  if (next === undefined || OUTER_END.test(next)) return false;
  if (mark === "'" && next !== undefined && !WORD.test(next) && !OUTER.test(next)) return false;
  const prev = text[index - 1];
  if (prev === undefined) return true;
  if (WORD.test(prev)) {
    // A quote welded to a word only opens if it is a nested quotation, which the
    // caller never asks about — treating it as text is what protects `don't`.
    return false;
  }
  return OUTER.test(prev) || prev === mark;
}

function isCloseQuote(text: string, index: number, mark: string): boolean {
  const prev = text[index - 1];
  if (prev === undefined || !WORD.test(prev) && !OUTER_END.test(prev)) return false;
  const next = text[index + mark.length];
  if (next === undefined) return true;
  if (WORD.test(next)) return false;
  return OUTER_END.test(next);
}

/** Index of the next `*` that is not part of a `**` pair, or -1. */
function findEmphasisEnd(text: string, from: number): number {
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (text[cursor] !== '*') continue;
    if (text[cursor - 1] === '*' || text[cursor + 1] === '*') continue;
    const prev = text[cursor - 1];
    if (prev === undefined || /\s/.test(prev)) continue;
    return cursor;
  }
  return -1;
}

/**
 * Split one paragraph into styled spans. Quotes are paired within the paragraph
 * and any unmatched quote is emitted as plain text, so a stray `"` can never
 * swallow the rest of the turn.
 */
function tokenise(paragraph: string): Span[] {
  const spans: Span[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer.length > 0) {
      spans.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  };

  while (index < paragraph.length) {
    const char = paragraph[index] as string;

    /* ---- out of character ------------------------------------------- */
    if (char === '(' && paragraph[index + 1] === '(') {
      const end = paragraph.indexOf('))', index + 2);
      if (end !== -1) {
        flush();
        spans.push({ kind: 'ooc', value: paragraph.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }

    /* ---- strong ------------------------------------------------------ */
    if (char === '*' && paragraph[index + 1] === '*') {
      const end = paragraph.indexOf('**', index + 2);
      if (end !== -1 && end > index + 2 && paragraph[end - 1] !== '*' && paragraph[end - 1] !== ' ') {
        flush();
        spans.push({ kind: 'strong', value: paragraph.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }

    /* ---- emphasis ---------------------------------------------------- */
    if (char === '*') {
      const end = findEmphasisEnd(paragraph, index + 1);
      if (end !== -1 && end > index + 1) {
        flush();
        spans.push({ kind: 'em', value: paragraph.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    /* ---- dialogue ---------------------------------------------------- */
    if (char === '"' || char === "'") {
      if (isOpenQuote(paragraph, index, char)) {
        // Walk to the first boundary-valid closing mark.
        let cursor = index + 1;
        while (cursor < paragraph.length) {
          if (paragraph[cursor] === char && isCloseQuote(paragraph, cursor, char)) break;
          cursor += 1;
        }
        if (cursor < paragraph.length && cursor > index + 1) {
          flush();
          spans.push({ kind: 'dialogue', value: paragraph.slice(index, cursor + 1) });
          index = cursor + 1;
          continue;
        }
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return spans;
}

function renderSpans(spans: readonly Span[], macros: Record<string, string> | undefined): ReactNode[] {
  return spans.map((span, position) => {
    const key = `${span.kind}-${position}`;
    if (span.kind === 'strong') return <strong key={key}>{substitute(span.value, macros)}</strong>;
    if (span.kind === 'em') return <em key={key}>{substitute(span.value, macros)}</em>;
    if (span.kind === 'dialogue') return <span key={key} className="rp-dialogue">{substitute(span.value, macros)}</span>;
    if (span.kind === 'ooc') return <span key={key} className="rp-ooc">(({substitute(span.value, macros)}))</span>;
    return <Fragment key={key}>{substitute(span.value, macros)}</Fragment>;
  });
}

function substitute(value: string, macros: Record<string, string> | undefined): string {
  if (!macros || !value.includes('{{')) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => macros[name] ?? whole);
}

type Block = { kind: 'break' } | { kind: 'para'; lines: string[] };

export function Prose({ text, streaming = false, className = '', macros }: ProseProps) {
  const blocks = useMemo<Block[]>(() => {
    const normalised = text.replace(/\r\n?/g, '\n');
    if (!normalised.trim()) return [];
    const out: Block[] = [];
    for (const chunk of normalised.split(/\n{2,}/)) {
      const body = chunk.replace(/^\n+|\n+$/g, '');
      if (!body) continue;
      if (SCENE_BREAK.test(body)) out.push({ kind: 'break' });
      else out.push({ kind: 'para', lines: body.split('\n') });
    }
    return out;
  }, [text]);

  if (blocks.length === 0) {
    return streaming ? (
      <div className={`prose-rp ${className}`}>
        <span className="caret-stream" aria-hidden="true" />
      </div>
    ) : (
      <p className={`prose-rp text-faint italic ${className}`}>Nothing written yet.</p>
    );
  }

  return (
    <div className={`prose-rp ${className}`}>
      {blocks.map((block, position) =>
        block.kind === 'break' ? (
          <div className="rp-break" key={`break-${position}`} role="separator" aria-label="Scene break">
            <span className="rp-break-mark">· · ·</span>
          </div>
        ) : (
          <p key={`para-${position}`}>
            {/* A paragraph keeps the author's own line breaks: prose, not flow. */}
            {block.lines.map((line, lineIndex) => (
              <Fragment key={`line-${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderSpans(tokenise(line), macros)}
              </Fragment>
            ))}
          </p>
        ),
      )}
      {streaming ? <span className="caret-stream" aria-hidden="true" /> : null}
    </div>
  );
}

