# Agent Note: The transcript is one message, not N

Status: implemented

## Problem

A conventional chat client sends the history as an array: one entry per turn, alternating
roles. That is the obvious shape, and for Reepi it is a cost bug.

DeepSeek caches a *prefix* of the request on disk and re-reads it at roughly 1/50th the miss
price, but only while the beginning of the payload stays byte-identical. With an array
history, the front of the payload is stable in the sense that earlier messages do not move —
yet every request still restates the entire transcript, and the composer has to serialise
each turn as its own message with its own role wrapper. Any change to how a *single* past
turn is serialised invalidates the cache from that message onward, and the wrappers
themselves are per-message overhead that grows with the conversation.

The deeper problem was that the payload had no single place to be *stable*. `composer.ts`
assembles blocks ordered by volatility, and the transcript was the one block whose internal
structure could change for reasons unrelated to its content.

## Decision

**The entire history is serialised into a single `user` message.** `composer.ts` renders the
transcript as one text block — `Speaker: text`, one turn per line — and emits it as one
message in the final payload, regardless of how many turns it contains.

The payload therefore has exactly five messages in steady state, whatever the conversation
length: the system/contract message, the frozen blocks, the collapsed history, the volatile
tail, and the instruction. A 27-turn scene reduces to a 5-message payload.

**Consequences of the shape that must be preserved:**

- The history block is the last large frozen thing in the payload. Everything after it
  (`state`, `retrieval`, `lore-before`, `author-note`, `instruct`) is volatile by design and
  cheap to change.
- Because the history is one block, its *append-only* property is what the cache depends on.
  Appending a turn extends the block; the previous turns' bytes are untouched. Editing a past
  turn rewrites the block from that point and invalidates the remainder — which is why the
  composer reports `payload.plan.blocks[].changed` per block rather than per message.
- Per-message role wrappers are gone. `Message.role` is still stored and still drives
  rendering, but it no longer appears in the wire payload as a separate message.

## Verification

`npm run verify:cache` drives the real composer against the live API and prints, per turn,
the predicted hit rate next to the API's own `prompt_cache_hit_tokens`. Steady state measures
**85–88% of input tokens served from cache** with prediction drift under 5 points, and the
plan endpoint reports `messages: 5` for a story with dozens of turns.

`npm run verify:store` pins the storage side: `Message.seq` is assigned per story and
preserved across an export/import round trip, so the collapsed ordering is stable.

## Alternatives considered

**Send the conventional message array.** Rejected: it makes the payload's stability a property
of N independent serialisations rather than one block, so any change to per-turn formatting
invalidates from that turn onward with no single place to reason about it. It also restates N
role wrappers, and the worked example showed the same conversation costing meaningfully more
at the miss price.

**Keep the array but freeze it — never allow editing a past turn.** Rejected because editing
a past turn is a normal writing action. The right response is to *report* the cost of the
edit, not forbid the edit. `Turn details` shows the invalidation for exactly this reason.

**Summarise the history periodically into a shorter block.** Rejected as a cache *improvement*
because summarisation is itself a paid call, and it replaces a block whose bytes are stable
with one that changes wholesale every time it runs. This is implemented as an explicit,
user-invoked action (`runAgentic('summarise')`) that writes the synopsis into a separate
field — never as something the composer does on its own.

**Put the history last, after the instruction.** Rejected: the instruction is the one block
that legitimately changes every turn, so placing it before a large stable block would
invalidate that block every time.

## Consequences

- **Readability cost.** The wire payload no longer resembles the transcript. Debugging means
  reading `composer.ts`'s render function, and the payload in the inspector shows one long
  history block rather than N turns. This is accepted: the plan view attributes tokens and
  cache state per *block*, which is the granularity that matters for cost.
- **Role fidelity cost.** The model infers role from the `Speaker:` prefix rather than from a
  message role. In practice this is what makes multi-character scenes work — the prefix names
  the speaker, which an array of assistant messages could not express.
- **Coupled to append-only.** If a future change makes editing a past turn cheap by rewriting
  history in place, this decision should be revisited rather than patched around.
