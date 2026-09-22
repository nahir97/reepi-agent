# Agent Note: One definition per helper, derived unions

Status: implemented

## Problem

A structural audit found the same helper declared in more than one place, and — importantly —
**two of the pairs had already diverged in behaviour.** These were not merely duplicated
copies awaiting a refactor; they were two different implementations of one idea, with no test
covering either.

- **`slug`.** `routes/portability.ts` capped the result at 60 characters; `web/store.ts` did
  not. Exporting the same story from the server and from the client produced two different
  filenames, and neither was wrong by its own definition.
- **`usd`.** The local copy in `web/store.ts` formatted with two tiers (5 decimals under
  $0.01, else 3). The shared `formatUsd` in `shared/cost.ts` has five tiers. The same amount
  rendered differently in a toast and in the cost panel.

The rest were literal copies: `SectionTitle` (twice), theme swatch tables (three tables × two
files), and the memory/note kind lists (once in `shared/types.ts`, again in each consumer).

The kind lists had a worse property than duplication. `MEMORY_KINDS` was a plain array in one
place and a type union in another, so adding a kind to the array produced **no compile error**
when the union was not updated — the validator would accept a value the type forbade, or
reject one it allowed, depending on which side was stale.

## Decision

**A helper is declared once. Where a list and a type describe the same set, the type is derived
from the list.**

Three specific outcomes:

- `slug` lives in `shared/text.ts` with an explicit `maxLength` parameter. It had to go in a
  *new* module rather than `shared/ids.ts` because `ids.ts` imports `node:crypto` and anything
  reachable from the web bundle must stay browser-safe. That constraint is exactly why the
  helper had forked.
- `usd` is deleted; both call sites use `formatUsd` from `shared/cost.ts`. Where the two
  disagreed, the shared five-tier version is the intended behaviour.
- `MEMORY_KINDS` and `NOTE_KINDS` are `as const` arrays in `shared/types.ts`, and the unions
  are derived: `type MemoryKind = (typeof MEMORY_KINDS)[number]`. The server's validator and
  the UI's picker both read the array, so a new kind cannot exist in one place and not the
  others. Adding one is a single edit that the compiler propagates.

UI primitives (`SectionTitle`, `Card`, `Metric`) moved to `web/components/panel.tsx`, and
theme presentation (labels, order, swatch gradients) to `web/theme.ts`.

## Verification

The audit is a search rather than a test: for every top-level declaration name, count how many
files *declare* it. After the change the count is **two**, and both are intentional wire
pairings — `streamChat` (browser client and server client) and `runTurn` (client verb and
server engine). Neither is a duplicate implementation.

`npx tsc --noEmit` is the enforcement for the derived unions: with `Record<CostEventKind, …>`
maps in the cost panel, adding a kind without updating its presentation is a compile error.

## Alternatives considered

**Leave the copies; they are small.** Rejected because two of them had already diverged. A
duplicated helper that agrees is a maintenance cost; one that disagrees is a bug with no test.

**Put `slug` in `shared/ids.ts`.** Rejected: `ids.ts` imports `node:crypto`, so importing it
from the web bundle would fail. The existing duplication was *caused* by ignoring this
constraint, so the fix had to respect it — hence `shared/text.ts` as a browser-safe home.

**Keep the local `usd` and make the shared one match it.** Rejected because the local version
was the lesser implementation: two formatting tiers means amounts between $0.01 and $1 lose
precision the panel needs, and the panel is where cost is actually read.

**Keep `MEMORY_KINDS` as an array and the union as a hand-written type.** Rejected: this is
the arrangement that produced the bug class. Deriving removes the possibility rather than
relying on discipline.

**Merge the near-identical `SectionTitle` implementations with a prop.** Rejected as
unnecessary configuration. The two differed only in a `truncate` class, and the version that
truncates is correct in both contexts.

## Consequences

- Adding a new memory or note kind is one edit in `shared/types.ts`; the compiler names every
  consumer that needs attention.
- `shared/text.ts` exists solely to be reachable from both bundles. It is small and that is
  correct — it marks a real boundary rather than an organisational preference.
- Several components now import from `panel.tsx` or `theme.ts` instead of declaring locally.
  Import lines increased; declarations did not.
