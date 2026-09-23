# Agent Note: No cost pill on the writing surface

Status: implemented

## Problem

[Progressive disclosure](2026-09-22-progressive-disclosure-of-instrumentation.md) established the
rule — a number is shown by default only if the writer must act on it to keep writing — and then
made one exception: a live cost pill above the composer carrying the predicted hit rate, this
turn's price and the saving. The exception did not survive use.

On a phone the pill is a row of digits sitting between the prose and the input, and the writer
described it as "meaningless and just occupying space". That is the rule speaking: a *prediction*
for a turn that has not been written is not something you can act on mid-sentence. The actuals
are already in each turn's `Turn details` — hit rate, hit/miss tokens, output, cost,
saved-vs-cold — and the prediction itself is the payload report's entire subject.

## Decision

**The composer carries no figures; the payload report is reached from Settings.**

- `CacheMeter.tsx` is deleted. `CachePill` and the never-referenced `CacheMeter` widget went with
  it; `cacheSafetySentence` — the one cache fact that *is* actionable while writing — moved to
  `src/web/components/cache-safety.ts` and is what the composer still shows.
- The composer's top row is the persona chip (who the model reads as you) and that sentence. The
  sentence stays because it is about the words just changed: which block an edit broke, and how
  many tokens re-pay the miss price.
- The block-by-block report keeps its home in **Settings → Payload report**, whose hint no longer
  claims a composer pill opens it.
- `Turn details` is untouched: it remains the home of the *actual* figures, folded under each turn.

## Alternatives considered

**Keep the pill, shrink it to the ring alone.** Rejected: the ring is still a figure on the
writing surface, and the complaint was its presence, not its width. A smaller version of a number
you cannot act on is still a number you cannot act on.

**Show the pill only while the composer has text.** Rejected for the reason the original note
already rejected focus/hover display: it couples unrelated things. The prediction also moves
*while you type*, so this would surface it at its least stable moment.

**Move the pill into the composer's bottom meta row, beside the model and effort.** Rejected:
that row says what will be sent, not what it costs, so this relocates the clutter rather than
removing it.

**Delete the payload report too.** Rejected: the report is the deliberate reading the original
rule preserved, and where block-level attribution lives. Deleting it would reverse the disclosure
decision rather than tighten it.

## Consequences

- **The payload report is two taps from the composer** (Settings → Payload report) instead of one.
  Accepted: it is read deliberately, and that fold is the point.
- **The predicted hit rate is no longer visible before sending.** The writer learns what a turn
  cost from `Turn details` after it, and can still read the prediction before sending from the
  report. The safety sentence covers the case that actually mattered — an edit that invalidates a
  frozen block.
- **One home for cache figures on the writing surface**: the sentence. Nothing else competes with
  the prose in that column.
- `CacheMeter.tsx` is gone; `cache-safety.ts` is the surviving half, named for what it does.

## Verification

- **A real 390px viewport** (the app rendered in a same-origin iframe at 390×800, so the `sm:`
  breakpoints apply as they do on the phone): the composer's top row is the persona chip and the
  safety sentence, with no digits, and `document.documentElement.scrollWidth === clientWidth ===
  390`. The only element wider than its box is the `sr-only` input label, which is intentional.
- The information the pill carried is still reachable and was read back: a rendered turn's `Turn
  details` expands to hit rate, hit/miss tokens, cost and saved-vs-cold; Settings → Payload report
  opens the block-by-block dialog listing every block with its tokens, volatility class and prefix
  position; and the safety sentence renders when the plan reports a changed block.
- `npx tsc --noEmit` and `npx vite build` clean; no reference to `CachePill` or `CacheMeter`
  remains in `src/`.
