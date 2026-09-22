# Agent Note: Recognising a changed block by identity, not by diff

Status: implemented

## Problem

The cache meter's job is to tell the writer *which* edit just cost them money, before they
spend it. It compares the payload about to be sent against the last payload that actually got
a cache hit, and reports the first block whose content moved.

The first implementation compared block content hashes positionally: `previous.hashes[i] ===
current.hashes[i]`. That is correct for blocks that appear in both payloads at the same index
and wrong for every block that appears, disappears, or shifts — which is most of them. An
empty lorebook produces no `lore-at-depth` block; the first turn with a recalled memory
inserts one and shifts every later block. The meter reported a cascade of changes, attributed
to the wrong blocks, and predicted hit rates that were off by more than thirty points.

The prediction error was the visible symptom. The actual defect was treating block *position*
as block *identity*.

## Decision

**Blocks are keyed by `BlockKind`, not by index.** The comparison is a map lookup per kind:

```ts
const previous = new Map(prior.blockHashes.map(([kind, hash]) => [kind, hash]));
for (const block of blocks) {
  block.changed = previous.get(block.kind) !== block.hash;
}
```

A block that is absent from the previous payload is `changed` — its kind has no prior hash to
match. A block that appears for the first time, or disappears entirely, is therefore reported
honestly rather than shifting its neighbours' verdicts.

The comparison target is **the last request that received a cache hit**, not the last request
sent. Those differ whenever a turn fails, is aborted, or is sent while offline: a failed
request never established a cache unit, so comparing against it would under-report the damage
of the next edit.

## Verification

`npm run verify:cache` prints predicted against actual per turn. Steady state lands within a
few points:

```
stable prefix  1825 tok  (predicted hit 91.6%)
ACTUAL usage   1920 hit / 267 miss  = 87.8%   drift -3.3pt
```

Before the fix the same measurement showed drift of -33pt on the first turn after a payload
change, because a shifted block was being reported as changed.

## Alternatives considered

**Compare hashes positionally and accept the drift.** Rejected: the meter's entire purpose is
to attribute cost to an edit. A meter that misattributes is worse than no meter, because the
writer acts on it — they will avoid editing a block that is not the expensive one.

**Compare the full serialised payload and report a character offset.** Rejected as too fine to
act on. "Character 8,412 changed" does not tell the writer which editorial decision caused it;
"the cast block changed" does.

**Recompute the previous payload from the transcript instead of storing hashes.** Rejected
because it requires storing or re-deriving past content and can drift from what was actually
sent. Storing per-kind hashes records what the API saw, which is the only thing that
determines a cache hit.

**Store the previous payload's message list and diff message-by-message.** Rejected for the
same reason the transcript is collapsed into one block: the unit the API caches is the
serialised prefix, and the block is its natural attribution boundary.

## Consequences

- The meter reports *causal* attribution: the writer sees which editorial action invalidated
  the prefix, which is the whole point of the feature.
- A block kind added in future participates automatically, because the map is built from
  whatever the composer emitted rather than from a fixed index list.
- The `changed` flag is only as good as the stored prefix record. A story whose record predates
  a block kind will report that kind as changed once, then converge. This is self-healing and
  was observed during development; it is a one-turn artefact, not a defect.
