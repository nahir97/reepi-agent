# Agent Note: Regenerate re-samples the same request instead of asking for a rewrite

Status: implemented

## Problem

The ⟳ control and the swipe gesture add a candidate variant to an existing assistant turn. They
already did the structural half right: `composeTurn` excludes the message being replaced from the
history, so the model never sees the text it is standing in for, and `runTurn` appends a variant
rather than creating a message. But the *instruction* sent as the final user message was:

> Write the next beat again, differently.

The model could not see the text it was replacing, so it reasoned about the instruction instead.
A real trace from the app: *"The previous response presumably existed but now we're asked to
rewrite. The instruction: 'Write the next beat again, differently.' So we need to produce a new
continuation from the transcript, alternative to whatever was originally generated."* It was
being asked to rewrite something it had not read — and the result read as a paraphrase of the same
beat rather than a fresh draw. The writer's report was exact: "regenerate is only acting as a
rewrite."

## Decision

**A regenerate sends the same request a continue sends.** `turnInstruction` now returns
`Continue the scene directly from where it stops.` for `regenerate` (and for `continue`, and for
the `variant` mode, which nothing sends).

The two verbs differ only where they always should have:

- **History**: regenerate excludes the message it replaces; continue includes everything.
- **Storage**: regenerate appends a variant to that message; continue creates a new one.

Variety across swipes is what sampling is for. The default temperature is not 0, so a fresh call to
the same prompt produces a fresh draw; telling the model to be different only made it deviate from
a text it could not see.

## Alternatives considered

**Keep the instruction and accept the paraphrase.** Rejected: it makes the verb a rewrite in
effect while pretending to be a re-sample, and the model's own reasoning shows it resolving that
contradiction. A regenerate that cannot produce a genuinely independent draw is not the feature a
roleplayer uses a swipe for.

**A regenerate-specific neutral instruction** ("Suggest another continuation"). Rejected as a
worse version of the same fix: it is still a meta-instruction the generation path does not need,
and it would make the payload depend on the verb for no gain. Identical-to-continue is the honest
definition, and it makes the request reproducible when a swipe is compared against its predecessor.

**Regenerate as a new message instead of a variant.** Rejected: variants are the swipe model, the
variant navigator and `activeVariant` already exist, and a new message per attempt would litter
the transcript and re-price the history block for each attempt.

**Lower or raise the temperature for a regenerate.** Rejected: sampling settings are per-turn
overrides the writer controls, and silently changing them per verb would make a swipe
un-reproducible.

## Consequences

- **A regenerate's payload is byte-identical to a continue's**, given the same transcript, apart
  from the one message excluded from history. Its prefix behaves predictably: the excluded message
  is the only thing that moved.
- **Two swipes can converge** at low temperature or high penalty settings. That is sampling
  behaving normally, not a regression; a swipe is a draw, not a guarantee of difference.
- **Regenerating an older message still keeps later turns in history**, so the model is asked for
  the next beat from the *end of the transcript* rather than a replacement for the middle turn.
  That is a pre-existing sharp edge of swiping arbitrary history, recorded here and not fixed by
  this change; the ⟳ is most honest on the newest assistant turn.
- **The `variant` chat mode is dead** — nothing sends it — and now falls through to the same
  continuation instruction. Left in place rather than removed, because deleting it is a wire
  contract change unrelated to this fix.

## Verification

- `npm run verify:store` — **188/188**, with three new payload checks: regenerate's final wire
  message equals continue's and is the continuation sentence; the replaced message is absent from
  regenerate's `history` block; and a plain continue still carries it.
- **A real regenerate against a copy of the live database** (DeepSeek, off-peak): the streamed
  reasoning no longer contains "rewrite" or "differently" and opens *"Hmm, the user wants me to
  continue this scene as Augusta…"*; the turn added variant 4/4 with usage `1920 hit / 242 miss`,
  555 output, **$0.000375**. The same call before the change reasoned verbatim about being asked
  to rewrite.
- `npm run verify:cache` — **86.1% (5632 hit / 906 miss)**, drift 10.1pt, unchanged from the
  previous run: `send` and `continue` instructions are untouched, and the edit is confined to the
  regenerate verb.
- `npx tsc --noEmit` and `npm run verify:notes` clean.
