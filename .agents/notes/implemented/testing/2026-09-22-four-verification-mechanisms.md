# Agent Note: Four verification mechanisms, and what each one proves

Status: implemented

## Problem

This project has four ways to check a change, and no note said which one covers what. The
result was predictable: `npx tsc --noEmit` became the default answer to "does it work?", and
it is a weak answer.

Two separate incidents had exactly this shape — green under `tsc`, broken when run:

1. **A refactor moved `src/server/agents.ts` into seven modules. The typecheck passed and the
   server crashed on boot.** A moved helper had never been given the `export` keyword its new
   caller needed. The failure lived in the module graph at import time, which no static check
   reaches.
2. **Three message routes were missing.** `PATCH /api/messages/:id`, `DELETE`, and
   `POST /messages/:id/variant` did not exist. `sanitiseMessage` and all four DAO methods had
   been written; the routes that called them never were. The client patched optimistically, so
   pin, exclude and inline-edit *appeared* to work and silently reverted. This survived a full
   UI verification pass because the checks exercised the composer and exports, never those
   buttons.

Both would have been caught by booting the server and calling one route. Neither was.

A third failure mode was subtler and worth recording separately: **a check that passes because
it used the wrong input.** A probe requested `format=text` from the export route, got `200`, and
concluded markdown export worked. The UI sends `format=markdown`, and the route accepts
`markdown` for *export* while accepting `text` for *import* — deliberately different
vocabularies for different operations. The probe had tested a third thing and reported success.

## Decision

**Four mechanisms, each proving a different thing. Pick by what you changed, not by what is
cheapest to run.**

| Mechanism | Proves | Cost |
|---|---|---|
| `npm run verify:cache` | the payload discipline holds against the live API | a fraction of a cent |
| `npm run verify:store` | every DAO round-trips; cascade deletes work; the bundle assembles | instant |
| `npm run verify:tx` | `transaction()` rolls back, commits, and refuses nesting | instant |
| browser + server boot | the thing actually runs and renders | seconds |

`tsc` and `vite build` are prerequisites, **not evidence**. They gate the other checks rather
than substituting for them.

Three rules follow, and each exists because of a specific failure above:

- **Boot the server after any structural change.** Import-time failures are invisible to static
  analysis. If the server does not start, nothing else measured matters.
- **Exercise every route you add, including one error path.** A route that returns `404`
  because it was never registered is indistinguishable from a successful patch on the client,
  which reconciles optimistically.
- **Confirm the input matches what the application actually sends.** When a check passes, ask
  whether the request shape was the real one. The `format` probe is the reference incident.

`transaction()` is checked by construction rather than by inspection: nesting throws, so a
misused transaction fails loudly instead of committing half a unit of work.

## Verification

`verify:store` pins behaviour *by name* — `warmups.get`, `settings` JSON round-trip,
`messages.update` clamping `activeVariant` — so a rename that breaks a call site fails the
suite rather than passing silently.

`verify:tx` proves the rollback case specifically, because a commit that works says nothing
about what happens when the third of ten writes throws:

```
threw: simulated failure after two writes
stories before=0 after-rollback=0 -> rolled back: true
clean run wrote 2 rows; persisted=2 -> committed: true
nested transaction -> cannot start a transaction within a transaction
```

UI changes were verified by reading the DOM rather than the screenshot: bubble count, avatar
`<img>` elements resolving rather than falling back to initials, the folded disclosure present,
and `scrollWidth` against `clientWidth` measured at nine widths from 320px to 1920px.

## Alternatives considered

**Rely on `tsc` and review.** Rejected: both incidents above were reviewed and typechecked. The
missing routes in particular were invisible because the client's optimistic patch made them look
like they worked.

**Write a permanent test suite covering everything.** Rejected for now, and deliberately. A
test earns its place only where a plausible bug would fail it; most of this codebase's real
failures were integration-shaped (a route not registered, a module not exported, a payload
mis-predicted) and are covered more directly by the four mechanisms above than by unit tests
that would assert implementation details. `verify:store` is the closest thing to a suite and it
tests behaviour through the DAO boundary. If the project grows contributors, this decision
should be revisited — the honest statement is that the current coverage is proportionate to a
single-author codebase, not that it is sufficient in general.

**One gate that runs everything.** Rejected because `verify:cache` spends money and needs a key,
so a combined gate would either be avoided or would silently skip the one check that matters
most. Keeping them separate lets each be run when it is relevant.

**Instrument the DAO layer to detect unwrapped writes at runtime.** Rejected in favour of a
static check, tracked as a proposal rather than implemented — see the
[unwrapped-writes proposal](../../proposed/testing/2026-09-22-detect-unwrapped-multi-row-writes.md).

## Consequences

- Verification costs more attention than running `tsc`. That is the point: the checks are
  chosen, and the choice is stated.
- Mechanical changes — a typo, a local rename — genuinely do not need more than `tsc`. The
  table is a guide, not a ritual.
- The gap that remains: nothing statically detects a multi-row write missing its transaction.
  Named here and in the transaction note rather than papered over.
