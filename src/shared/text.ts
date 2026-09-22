/**
 * Browser-safe text helpers.
 *
 * Deliberately free of `node:` imports so both the server and the web bundle can
 * use the same functions. `ids.ts` cannot serve this role — it needs `node:crypto`
 * — and that constraint is precisely why `slug` had drifted into two copies with
 * *different* behaviour: the server capped filenames at 60 chars, the client did
 * not. One definition, stated behaviour.
 */

/**
 * A filesystem- and URL-safe slug.
 *
 * Lowercased, non-alphanumerics collapsed to single dashes, trimmed, and capped.
 * The cap is applied last so a long title still ends on a whole word boundary
 * rather than a truncated token.
 */
export function slug(text: string, fallback = 'reepi', maxLength = 60): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return cleaned || fallback;
}

/** Truncate for a toast or a one-line summary, with a real ellipsis. */
export function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
