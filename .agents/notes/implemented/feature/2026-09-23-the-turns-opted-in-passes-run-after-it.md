# Agent Note: The turn's opted-in passes run after it

Status: implemented

## Problem

The composer's *This turn only* panel offers five switches. Three of them —
**Director**, **Archivist**, **Conductor** — were carried by the request and read by
nothing on the server. `ChatRequest['overrides']` declared them, `Composer.tsx`
rendered them, and the payload was byte-identical with them on or off. A writer could
turn on "Director — notes after the turn" and get no notes, forever, with no error.

The dead switches were the worse half of a wider split: the passes were reachable only
from the inspector rail, one at a time, by hand. "Notes after the turn" is a thing a
writer wants *on*, the way an author's note is on — not a button they press after every
single turn.

## Decision

**A pass switched on in the panel runs after the turn, inside the turn's own request.**

`runTurn` calls `runRequestedPasses` once the turn is written, and runs whichever of the
three the writer enabled. After the turn, and specifically:

- **The pass reads the story with the turn in it.** A Director that ran before the turn
  would be reviewing the scene one beat stale — which is what the old flow did when the
  writer pressed the rail button late.
- **The cache is at its warmest.** The turn's own payload unit was persisted seconds
  ago, so the Director and the Conductor — both of which compose the story's own head —
  are served from it rather than paying a private miss. The Conductor in particular
  re-sends the turn's *exact* bytes (`payload.messages`), which is the same trick that
  makes its variants cheap, and here the first variant is a hit as well.
- **The prose is already on screen.** A pass that fails cannot cost the writer their
  turn: each runs inside its own guard, and a failure becomes a receipt, not an error.
- **A turn that wrote nothing runs no passes.** There is no beat to react to, and billing
  somebody for three passes on top of a failed turn is the worst version of this feature.
  That guard is also what surfaced
  [an empty generation leaving a blank row](../bug-fix/2026-09-23-an-empty-generation-says-so.md)
  and saying nothing about it.

**The Conductor's candidates become swipes on the turn.** Its whole job is N
alternatives to the same continuation, so the turn's own text stays as variant 0 and the
candidates are appended as variants 1..N with the judge's pick made active. The writer
swipes back to what they watched arrive; nothing is destroyed and nothing is silently
replaced.

**A pass that produced nothing is reported as a failure, not a result.** The Conductor
with no candidates says "no candidate produced text" and shows what it cost — "0
alternatives, kept #1" would read as success to anyone glancing at it, and the writer paid
for the attempt either way.

**Each pass reports a receipt.** A new `pass` stream event carries
`{pass, label, ok, detail, costUsd}`; the transcript's *Agent activity this turn* fold
lists it and a toast announces it. Spending money on the writer's behalf without telling
them is the thing the panel's silence was already doing.

## Alternatives considered

**Run the passes before the turn, so the notes steer the beat being written.** Rejected
for the Director: its brief is a *reaction* to prose, and steering the same beat with it
would mean a Director call on every send *and* a re-price of the payload the turn was
about to send. (A writer who wants a note to steer a beat has the author note field, and
kept director notes already ride the volatile tail.)

**Run them concurrently with the narration stream.** Rejected: the passes would read the
story without the turn in it, and the Conductor could not reuse the turn's payload —
there would be nothing to reuse yet.

**Have the Conductor's judge pick between its candidates and the turn's own text.**
Rejected as a false comparison today: the judge never saw the streamed text, so
activating its pick over that text would assert a ranking that was never made.
Re-scoring the full set is the better feature and stays open — it costs one more judge
call, and it would need the judge to see all four candidates.

**Fire the passes after the response stream closes.** Rejected: the receipts travel on
that stream, so nothing could be reported, and a failure would be invisible. The cost is
latency — the send button stays busy until the passes finish, a few seconds on
`deepseek-flash` — and that is the honest price of the writer's own choice.

## Consequences

- Leaving a switch on means every turn spends on it until the panel is reset. The panel
  says "this turn only"; what it means is "until you reset", which is now a distinction
  that costs money. Worth rewording.
- The passes are serial, so a turn with all three on waits for all three.
- The Conductor writes variants onto the turn's message, so `messages.reasoning` is
  padded per variant to stay aligned with `variants` — a message whose variant list is
  longer than its trace list would show the wrong trace on a swipe.
- The turn's own `usage` still reports the narration's numbers only. The passes' spend
  goes to the ledger under its own `CostEventKind` and to the receipt, rather than being
  folded into the turn's totals, where it would mix four requests into one figure.
- The Archivist and the Summariser still run their own contexts; only the Conductor and
  the Director ride the story payload. See
  [a pass rides the story's prefix](../architecture/2026-09-23-a-pass-rides-the-story-prefix.md).

## Testing

`npm run verify:cache` runs one real turn with all three switches on in a throwaway
database and prints the receipts, the variant count on the turn, and the ledger kinds —
so a pass that stops firing, or a Conductor whose candidates stop landing on the
message, fails loudly instead of quietly costing nothing.
