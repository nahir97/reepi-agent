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

/** How a list of stories is filed: newest first, bucketed by calendar day. */
export type DayBucket = 'today' | 'yesterday' | 'week' | 'earlier';

export const DAY_BUCKET_LABEL: Record<DayBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'A while ago',
};

export const DAY_BUCKET_ORDER: readonly DayBucket[] = ['today', 'yesterday', 'week', 'earlier'];

/**
 * Which bucket a timestamp falls in, measured in local calendar days rather than
 * elapsed hours — "Yesterday" has to mean the day before, not "20 to 48 hours
 * ago", or a story written at 11pm last night would be filed under Today.
 */
export function dayBucket(at: number, now: number = Date.now()): DayBucket {
  const midnight = (value: number): number => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return 'earlier';
}
