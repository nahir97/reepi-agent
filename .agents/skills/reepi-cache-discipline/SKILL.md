---
name: reepi-cache-discipline
description: Use when changing anything that shapes the DeepSeek request payload in the reepi-agent repo — prompt blocks, the composer, block ordering, agent prompts, the transcript renderer, lorebook injection, or per-turn model settings; and whenever cache hit rate regresses, a cost figure looks wrong, or `npm run verify:cache` shows prediction drift.
---

# Keeping reepi's cache discipline

Reepi's cost model rests on one external fact: DeepSeek caches the prefix of a request on disk
and re-reads it at roughly 1/50th the miss price, but only while the beginning of the payload
stays byte-identical. Everything in this repository is downstream of that. This skill is how
to change the payload without quietly destroying the thing that makes the product viable.

This is guidance, not a checklist. Follow the code, keep judgement active, and remember that a
cache regression is silent — nothing errors, the bill just goes up.

## Read the contracts first

- `AGENTS.md` § 1 ("The one law") and § 3 (invariants).
- `.agents/notes/implemented/architecture/2026-09-22-transcript-single-message.md` — why the
  history is one message, and what depends on it.
- `.agents/notes/implemented/architecture/2026-09-22-narration-carries-no-tools.md` — why the
  narration request must not gain a `tools` array, and the unbounded cost if it does.
- `src/shared/types.ts` → `BLOCK_ORDER`, `BLOCK_VOLATILITY` — the canonical ordering.
- `src/server/composer.ts` — the only place that assembles a payload.

## The rule, and the two things that look harmless

**A block's edit invalidates that block and every block after it.** Blocks are sorted by
volatility: frozen material (contract, genre, style, story, cast, persona, lore anchors) first,
volatile material (scene state, recalled memories, author note, instruction) last. Before
editing anything, identify which block you are touching and what sits behind it.

The two mistakes worth naming, because both look safe:

**Adding a `tools` array.** DeepSeek then requires the full `reasoning_content` echoed back on
every later turn, billed as input, growing with conversation length, and not cacheable the way
the prefix is. If narration ever needs a tool, it belongs in a side-channel call — see the
no-tools note. There is no version of this that is cheap.

**Splicing agent output into the transcript.** Agent results are durable state and belong in
their own block (`director`, `retrieval`, `state`). Written into history, they rewrite the tail
of the one block the cache depends on.

## Measure, never assume

`npm run verify:cache` is the only authoritative check. It drives the real composer against the
live API in a throwaway database and prints, per turn, the prediction beside the API's own
`prompt_cache_hit_tokens`.

Steady state to expect: **85–88% of input tokens served from cache**, prediction drift under
5 points, and `messages: 5` in the plan output for a story of any length.

Read the drift, not just the rate. A hit rate that holds while drift grows means the *meter* is
wrong, not the cache — which is a real bug with its own history
(`.agents/notes/implemented/bug-fix/2026-09-22-block-identity-not-diff.md`).

For a payload change with no API key available, `POST /api/plan` reports the same block
tokens, per-block `changed` flags and `stablePrefixTokens` without spending anything. It is the
right tool while iterating; `verify:cache` is the confirmation.

## Where the silent failures live

- **Positional comparison instead of identity.** Comparing blocks by index rather than by
  `BlockKind` misattributes every change once a block appears or disappears. This exact bug
  cost 33 points of prediction accuracy once.
- **Comparing against the last request *sent*.** The comparison target is the last request that
  received a *cache hit*. A failed or aborted turn established no cache unit, so comparing
  against it under-reports the next edit's damage.
- **A timestamp or random value anywhere in the prefix.** It invalidates everything behind it,
  every turn. Canonical JSON, stable key order, no `Date.now()` in prompt text.
- **Reordering the cast or lore entries.** Order is bytes. Adding a card re-prices every token
  behind it, which the UI states to the writer and reviewers should remember.
- **Changing `effort` or `temperature` mid-story.** These are story-level settings precisely so
  they are changed deliberately; per-turn overrides exist for one-off cases and are labelled as
  such.

## When you change the payload

1. Rebuild the payload mentally in `BLOCK_ORDER` and state which block moved.
2. Run `POST /api/plan` and read `blocks[].changed` — confirm only what you intended moved.
3. Run `npm run verify:cache` if a key is available, and compare drift to the last known good.
4. If the change moves a block earlier in the order, say so explicitly in the Agent Note. That
   is the direction that costs money.

## Reporting

State the measured numbers, not adjectives. "88.3% hit, drift 4.0pt, $0.00076 for three turns"
is a result; "cache still works" is not. If a change is expected to cost more, quantify it and
say so — the
[instrumentation note](../../notes/implemented/feature/2026-09-22-progressive-disclosure-of-instrumentation.md)
exists because an accurate number shown in the right place is the product's whole value.
