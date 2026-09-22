# Agent Note: Reverting the module split

Status: rejected — the measurement that motivated it did not survive re-testing

## Problem

After the module split landed (43 → 100 files), a review raised a reasonable objection: the
split may have been overdone, and reverting the over-reached parts would restore a smaller,
easier tree. The proposal was to keep the three genuinely-unrelated-files split, the
deduplication, and the transaction fix, and revert the rest to their original files.

The motivating evidence was a set of confident claims about over-granularity, made from
memory of the refactor rather than from the code.

## Proposal

Revert `src/web/components/inspector/` (7 tab files back into `Inspector.tsx`),
`src/web/components/dialogs/` (4 dialogs back into `modals.tsx`), `src/web/store/` (7 slices
back into `store.ts`), and consolidate `src/server/store/` from 13 files to ~4. Roughly eight
files would be merged away, on the stated grounds that "several files are 30–60 lines",
"splitting one cohesive unit across files to satisfy a target" had occurred, and — the claim
called the strongest signal — "the splits forced artificial exports."

## Why it was rejected

**The evidence was re-measured before acting, and it did not hold.**

The central claim was measurable, so it was measured. If a split had forced artificial
public surface, its modules would export things no sibling consumes. Across the seven split
modules: **123 exports, 123 referenced outside their own file. Zero artificial surface.**

The specific `export` errors encountered during the split were not artificial coupling,
which had been the interpretation. They were real omissions: `agents/context.ts`'s helpers
are consumed by **6 sibling modules**, `routes/library/shared.ts` by 2,
`store/slices/helpers.ts` by 3. Widening those exports was correct each time.

The granularity claim was also wrong on the numbers. `server/store/` modules run 38–183
lines — five at 40–80, the rest 100–183 — not the "several at 30–60" claimed. And only
**4 of 54** split files are majority-boilerplate, of which **3 are barrels**, which are
supposed to be thin. `slice.ts` at 13% code density is a type declaration; that is what it is.

**A revert would have restored two latent bugs.** The deduplication had removed two helpers
whose copies had *diverged in behaviour*, not merely in location:

- `slug` was capped at 60 characters in `routes/portability.ts` but not in `web/store.ts`, so
  the same story title produced two different filenames depending on which path exported it.
- `usd` formatted with two tiers locally (5 and 3 decimals) while the shared `formatUsd` has
  five, so the same amount rendered differently in a toast and in the cost panel.

Reverting the dedup would have reinstated both.

**It would also have undone two outright fixes:** atomic multi-row writes, and the
`summarise` cost attribution that the ledger was silently mis-recording.

**And the real defect was elsewhere.** The genuine over-reach was a *documentation* rule — a
"nothing over ~400 lines" instruction written into `AGENTS.md` — which would have caused
future over-splitting by making a line count the goal. That was fixed in place rather than by
reverting code. See
[the mechanical line-count rule](../process/2026-09-22-mechanical-line-count-split-rule.md).

The lesson recorded here is procedural, not structural: the objection was worth raising, and
the correct response to it was to **measure before deleting**, not to act on either the
original confidence or the objection's confidence.

## What was conceded

The objection was not baseless. 43 → 100 files and 17,171 → 18,325 LOC is ~7% growth from
docblocks and import lines, which is a real if small tax. `store/slices/getters.ts` at 29
lines and `slice.ts` at 24 are small enough that a future consolidation might merge them, and
that would be a defensible change **if** it preserved the invariants — `activeController`
staying in one shared module above all.

What did not survive scrutiny was the general claim, and a revert is not a partial action.
The specific small-file consolidations remain available as a separate, narrowly-scoped
proposal; none was written, because none was demonstrably worth the churn.

## Alternatives considered

**Revert anyway, on the grounds that a smaller tree is safer.** Rejected because the
measurement ran the other way. A smaller tree is not a goal; a tree where each file has one
reason to change is the goal, and the split achieved that. Reverting on a hunch would have
destroyed verified work and restored two behavioural bugs.

**Revert only the modules with no artificial exports.** Every split module had none, so this
reduces to the first alternative.

**Split the difference: merge the smallest files as a gesture.** Rejected as churn without a
reason to change. Merging `getters.ts` (29 lines) into a neighbour changes nothing about how
the code is understood, and costs a diff, a review and a risk of moving `runtime.ts` state.
A change with no reason to change is exactly what the
[split rule](../process/2026-09-22-mechanical-line-count-split-rule.md) prohibits.

## Consequences

- The split stands. The largest file is 704 lines of cohesive turn orchestration; the median
  is ~130; nothing is majority-boilerplate except barrels.
- This note exists so the idea does not have to be re-litigated from scratch. A future
  reader who feels the tree is too granular now has the numbers, and the specific narrow
  consolidation that *would* be acceptable.
- The measurable claim in the "Problem" section is what makes this note durable. A rejection
  on taste alone would invite retry; this one is falsifiable and was falsified.
