# Agent Note: Atomic multi-row writes

Status: implemented

## Problem

Two operations write across many tables, and neither was atomic.

`recreateStoryBundle` (duplicate and import) touches ten: a story, its scenes, characters,
personas, lore, messages, memories, threads, notes, and a remapped set of foreign keys
including message ids referenced by memories and scene ids referenced by messages and
threads. It performed **10 sequential DAO writes with no transaction.**

`finalise` in `orchestrator.ts` writes six things for one completed turn: the message row, its
cost event, the prefix record, a prefix prune, and a story touch.

A failure partway through either sequence leaves a row set that no later request can repair,
because nothing records what it was *meant* to be. The second case is worse than it sounds: if
the message write succeeded but the prefix record did not, the turn appears complete while the
next turn's cache prediction silently degrades — with nothing on screen to indicate why.

## Decision

**Every multi-row write goes through `transaction()` in `src/server/db.ts`.**

```ts
export function transaction<T>(work: () => T): T {
  const handle = getDb();
  handle.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    try { handle.exec('ROLLBACK'); } catch { /* connection already unusable */ }
    throw error;
  }
}
```

`BEGIN IMMEDIATE` rather than a deferred `BEGIN`: it takes the write lock up front rather than
on first statement, so a concurrent writer cannot interleave between the reads and the writes
inside the block.

**`transaction()` is not re-entrant.** `node:sqlite` has no nested transactions, so a nested
call emits a second `BEGIN` and throws. Wrapped blocks must stay flat — this is enforced by
the runtime rather than by convention, which is the desired failure mode: it throws loudly
rather than silently committing half of an outer unit of work.

Both call sites now wrap: `recreateStoryBundle` delegates to a private `insertBundle`, and
`finalise` wraps its six writes.

The rollback path deliberately swallows a rollback failure. If the connection is already
broken the original error is the one worth propagating; replacing it with a secondary error
about `ROLLBACK` would hide the cause.

## Verification

`npm run verify:tx` proves four properties against a real database:

```
threw: simulated failure after two writes
stories before=0 after-rollback=0 -> rolled back: true
clean run wrote 2 rows; persisted=2 -> committed: true
nested transaction -> cannot start a transaction within a transaction
copy: stories 3->4, scenes copied=1, persona linked=true
```

The rollback case is the one that matters: a commit that works proves nothing about what
happens when the third of ten writes throws.

`npm run verify:store` covers the happy path of the same path — 22 DAO round-trips including
the full bundle assembly.

## Alternatives considered

**Rely on `PRAGMA foreign_keys` and cascade behaviour.** Rejected: referential integrity
prevents dangling references, not partial writes. A half-created story has no dangling
foreign key; it is simply incomplete, and the database has no opinion about that.

**Wrap each DAO write in its own transaction.** Rejected as the status quo with more
overhead. The unit of work is the *operation*, not the statement.

**Add a repair pass that detects and deletes orphaned row sets on boot.** Rejected: it
requires a way to identify orphans, which means recording intent before writing — a
transaction log in all but name. The transaction is the simpler mechanism and the database
already implements it correctly.

**Use a nested-transaction helper that tracks depth with a savepoint.** Rejected as unused
complexity. Nothing in the codebase needs composition, and the throw makes misuse impossible
to miss.

## Consequences

- A failed import leaves the database exactly as it was, rather than accumulating debris that
  a user must clean by hand. The route returns an error and the writer retries.
- Write lock contention is now slightly higher, because `IMMEDIATE` acquires eagerly. On a
  single-user local application this is not measurable.
- Any future multi-table write must remember to wrap. The gate is `verify:tx` plus review;
  there is no static check that a sequence of DAO calls is wrapped, and that is a real gap.
  A test that can detect an unwrapped multi-write sequence would need to instrument the DAO
  layer. Named here rather than solved.
