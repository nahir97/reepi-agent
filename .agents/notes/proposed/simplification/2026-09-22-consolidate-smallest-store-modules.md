# Agent Note: Consolidating the smallest store modules

Status: proposed

## Problem

`src/server/store/` has one module per entity — 13 files, 38–183 lines each. The split is
justified by a clear rule (a row mapper belongs beside the DAO that owns it, so a schema change
and its reader are one edit) and it holds up: there are zero cross-DAO calls, so the boundaries
are real rather than imposed.

But the smallest members are small enough to question. `settings.ts` is 38 lines and
`warmups.ts` is 47. `rows.ts` is 18 lines holding two numeric coercions and a `Row` type.
Both are genuinely single-purpose, yet each costs a file, an import line, and a place for a
reader to look.

The same question applies, more weakly, to `web/store/slices/getters.ts` (29 lines) and
`web/store/slice.ts` (24).

This was raised during review of the split and deliberately **not** acted on, because a
consolidation with no reason to change is exactly the churn the
[split rule](../../rejected/process/2026-09-22-mechanical-line-count-split-rule.md) prohibits.
Recording it as a proposal keeps it available without pretending it is scheduled.

## Proposal

Merge the configuration-shaped DAOs — `settings.ts` and `warmups.ts` — into a single
`config.ts`. Both are key/value stores with no relationships to other entities and no shared
consumers that would care about the distinction. `loadStoryBundle` does not read either, and
`prefixes.ts` (which does related work) stays separate because it is keyed by fingerprint
rather than by story.

Leave `rows.ts` and the web-store files alone. `rows.ts` is imported by all 13 DAO modules, so
folding it into a neighbour would create an arbitrary dependency from every module to one
entity's file. The web-store slices are each one coherent group of actions and merging them
would mix concerns to save a file.

Also correct the barrel's re-export comment to describe the merged shape, and update
`AGENTS.md`'s "thirteen DAO modules" reference to the new count.

## Acceptance criteria

- `npm run verify:store` passes, including `warmups.get` and the `settings` JSON round-trip,
  which are pinned by name in that script and must be updated to the new module path.
- `npm run verify:tx` still passes — neither module participates in a transaction, so this is
  a regression check rather than a change.
- The barrel still exports `settings` and `warmups` unchanged, so no call site moves.
- `npx tsc --noEmit` exits 0.

## Risks

**Low.** Both modules are leaf DAOs with no dependents beyond the barrel, and the store proof
pins their behaviour by name.

The real risk is precedent: doing this invites the same treatment for `prefixes.ts` (79 lines)
and `notes.ts` (59), and eventually for the module split itself. The proposal is deliberately
scoped to exactly two files whose *reason to change* is genuinely identical — configuration
persistence — rather than to a size threshold. If the next candidate needs a sentence of
justification, that sentence is the signal to stop.

A second risk is that this is not worth doing at all. It is a small readability gain with a
real diff, and it is entirely reasonable to leave this proposal unbuilt. That is why it is a
proposal rather than a commitment.

## Alternatives considered

**Leave the tree as it is.** A legitimate and probably correct answer. Recorded as the default:
this note exists so the option is documented, not so it is taken.

**Merge all configuration, prefix, and warmup persistence into one `state.ts`.** Rejected:
`prefixes.ts` is the cache-correctness record and its consumers are the composer and
orchestrator. Merging it with unrelated key/value storage would make a load-bearing module
look like a utility drawer.

**Merge by line count — everything under 50 lines.** Rejected explicitly. That is the
mechanical rule this project has already rejected once; see the
[line-count rejection](../../rejected/process/2026-09-22-mechanical-line-count-split-rule.md).
