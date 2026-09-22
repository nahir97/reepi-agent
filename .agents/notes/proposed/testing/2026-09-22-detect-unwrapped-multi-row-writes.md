# Agent Note: Static detection of unwrapped multi-row writes

Status: proposed

## Problem

`transaction()` is now the rule for any write sequence touching more than one table, and both
known call sites use it. There is no mechanism that finds the *third* one.

The gap is real rather than theoretical. A new route that creates a story with its opening
scene and default persona — a very plausible addition — would perform three writes. Nothing in
the type system distinguishes a sequence of DAO calls from a single one; `stories.create()`
followed by `scenes.create()` compiles identically whether or not a transaction wraps them.
The failure mode is silent: the code works until a write fails partway, and then leaves an
incomplete row set that no later request can repair, because the database has no record of
what was intended.

`AGENTS.md` states the rule and `npm run verify:tx` proves `transaction()` is correct. Neither
proves that it is *used*. The
[atomicity note](../../implemented/bug-fix/2026-09-22-atomic-multi-row-writes.md) names this as a
coverage gap rather than solving it.

## Proposal

Add a static check that flags a function body containing two or more distinct DAO *mutation*
calls (`create`, `update`, `remove`, `save`, `record`, `add`, `upsert*`, `prune`, `touch`) at
the same lexical level without an enclosing `transaction(...)`.

Implementation would be an AST walk over `src/server/**/*.ts`: locate the nearest enclosing
function-like node for each mutation call, count distinct DAO receivers per function, and
report functions exceeding the threshold that are not lexically inside a `transaction()`
call. Report as a warning list by default and fail under a `--strict` flag, so it can be
adopted without immediately blocking work.

The check will need an explicit allowlist, and the allowlist is the interesting part: a
function that writes one row and then touches a denormalised counter may be legitimately
non-atomic, and forcing a transaction there would be noise. Every entry must carry a
one-line reason, in the same spirit as the sanitiser rejection list.

## Acceptance criteria

- `npm run verify:writes` reports the two known wrapped sites as clean and names any unwrapped
  multi-write function it finds.
- The check's own fixtures pin: a wrapped pair (clean), an unwrapped pair (flagged), a single
  write (clean), two writes to the *same* DAO (clean — that is one entity's own invariant), and
  a nested `transaction()` (flagged, since nesting throws at runtime).
- `npm run verify:tx` continues to pass unchanged.

## Risks

**False positives are the main risk**, and they are costly in a different way from a missed
detection: a gate that cries wolf gets suppressed, and a suppressed gate is worse than no gate
because the rule then appears enforced. This is why the proposal starts in warning mode with a
reasoned allowlist rather than as a hard failure.

**The AST walk needs to distinguish reads from writes.** `stories.get()` inside a function that
also calls `scenes.create()` is one write, not two. Getting this wrong makes the check
unusable, so the read/mutate split must be explicit and conservative — classify unknown methods
as reads, so the check under-reports rather than over-reports.

**It cannot see intent.** A function doing two writes where the second is genuinely
best-effort should be allowed, and no static check can tell that apart from an oversight. The
allowlist is the honest mechanism for this, which is why it is part of the proposal rather than
an afterthought.

## Alternatives considered

**Rely on review and `AGENTS.md`.** Rejected as the current state, which missed a ten-write
sequence for the entire life of the project until a structural audit found it by reading.
Documentation did not detect it and would not detect the next one.

**Instrument the DAO layer at runtime and log an error on a second write outside a
transaction.** Rejected as strictly worse for development: it only fires on the code path that
actually runs, requires a flag or a log to notice, and adds a counter to every DAO call in
production. A static check catches the pattern before it ships.

**Make `transaction()` mandatory by construction — a single `unitOfWork` API that all writes
must go through.** Rejected as a large migration for a small codebase. It would also make
single-write paths pay for a transaction they do not need, and the ergonomics of returning
values through such a wrapper are worse than the current explicit call. The idea has merit at
a larger scale; here it is a bigger change than the problem justifies.

**Detect unwrapped writes via a database-level savepoint counter.** Rejected: `node:sqlite`
exposes no per-statement hook, and adding one would mean wrapping every prepared statement,
which is the previous alternative with worse ergonomics.
