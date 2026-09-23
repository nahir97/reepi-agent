# Agent Note: An empty generation says so

Status: implemented

## Problem

A turn that produced no prose said nothing about it and left a blank row behind.

`finalise` has always guarded this case, and its comment states the intent plainly:
*"An empty generation on a brand-new message leaves nothing worth keeping."* The guard
read `isNewVariant && variants.length === 1`. For the case it describes, that is never
true: a fresh message is created holding one empty placeholder variant, and the turn
writes into variant **0**, so `isNewVariant` is `false` and the branch never fires. The
empty text was written over the placeholder, the row was kept, and no error was emitted —
the writer's transcript gained a blank assistant bubble and nothing else.

It is reachable without exotic conditions. Any model that spends its whole output budget
inside a reasoning trace returns `content: ""` with a `length` finish reason, so a story
running with thinking on and a small `maxTokens` hits it every time. (`deepseek-flash`
with `reasoning_effort` above `none` on a 160-token budget spends all 160 on thinking and
produces no prose at all.)

## Decision

**A generation with no prose emits its error and leaves no variant behind.**

The condition is now on the *text*, and the row is judged by what it already holds:

```ts
if (args.text.trim().length === 0) {
  if (existing.variants.every((variant) => variant.trim().length === 0)) messages.remove(args.targetId);
  args.emit({ type: 'error', message: 'The model returned no text.' });
  return;
}
```

- **A brand-new message** holds nothing but its placeholder, so the row is removed.
- **A failed regenerate** keeps the turn it was replacing and gains no empty swipe. The
  old condition appended one, which put a blank candidate in the swipe list of a turn
  that was working.

## Alternatives considered

**Retry the generation.** Rejected here: an empty reply is not usually a transport
failure, and the retry rules above this point exist for transport failures (the client
already backs off on a retryable status *before* anything streams). Re-sending would
silently double the bill for a request whose non-streaming sibling had already answered.

**Keep the row and mark it empty.** Rejected: an empty variant is not a turn. It would
render as a blank bubble, and the composer already treats blank variants as absent when
it builds the transcript — so the row would exist only to be skipped.

## Consequences

- The transcript no longer holds blank assistant turns, and the writer is told the
  generation failed instead of watching a bubble stay empty.
- The failed call's own spend — real money, since the reasoning tokens were billed — is
  still not written to the ledger, because this path returns before the ledger write.
  That predates this fix and is recorded here rather than changed in passing: whether a
  failed turn belongs in the ledger is its own decision.
- The test that found this was a pass run with a deliberately tiny output budget; the
  empty reply was incidental to what it was checking. It is worth keeping in mind that
  the cheapest way to exercise a failure path is to shrink a budget, not to fake an
  error.
