# Agent Note: A regenerate replays the context before the turn, with no instruction

Status: implemented

## Problem

The refresh control adds a candidate variant to an assistant turn. Two things were wrong with how
it asked for that variant.

**It gave an instruction the original call never had.** It first sent *"Write the next beat again,
differently"*; the model could not see the text it was replacing, so it reasoned about the
instruction instead — a real trace read *"The previous response presumably existed but now we're
asked to rewrite… alternative to whatever was originally generated"* — and produced a paraphrase.
The next attempt replaced that wording with the `continue` sentence, which was better but still a
cue: the verb kept steering a generation that is supposed to be a re-draw.

**It kept the later turns.** History excluded only the target message, so regenerating an older
turn left everything after it in context — the model was asked for a beat that follows the *end* of
the transcript rather than a replacement for this turn's position.

## Decision

**A regenerate replays exactly the context that preceded the turn, and asks for nothing.**

- **History is truncated at the target.** `composeTurn` slices the scene's messages before the
  target's index, so the message and everything after it are out of context. This is what makes a
  regenerate produce an *alternative for that position*, whether it is the newest turn or an older
  one.
- **No per-turn cue.** `turnInstruction` returns `''` for `regenerate` (and for the unused
  `variant` mode), and the composer only appends its final `user` message when that string is
  non-empty. The model generates from the transcript, which ends on the turn being answered.
- **No generated clause in the post-history instruction.** A new `ComposerInput.resample` flag
  drops the composer's `"Write the next beat. Target N words."` / continue cue. The writer's own
  `story.instruct` stays for every verb — that is authored context (SillyTavern's
  `post_history_instructions`), not a synthetic per-turn cue.
- **Storage is unchanged**: a new variant on the message it replaces, with `activeVariant` moved to
  it. `continue` and `send` are untouched.

The result is the first payload in Reepi that can end on something other than a writer turn: with
no volatile tail it is `system, system, user`, where the last message is the transcript itself.
DeepSeek accepts that and generates from it (verified below).

## Alternatives considered

**Borrow the `continue` sentence** (what shipped first). Rejected: it is still an instruction the
original call did not have, and the model answered it as one. Re-sampling means the request is the
same request.

**Keep "write the next beat again, differently."** Rejected: it names a text the model cannot see,
so the only thing it can act on is the meta-instruction. It produced a rewrite in effect.

**A regenerate-specific neutral cue** ("Suggest another continuation"). Rejected as a worse version
of the same idea: a cue the generation path does not need, and one that makes the payload depend on
the verb.

**Exclude only the target and keep the later turns.** Rejected: it asks for a beat after turns that
already exist, which is not a replacement for the target's position.

**Move the volatile tail before the history so the payload always ends on a user message.**
Rejected: it shifts the history block's position in the message list, so every message from the
tail onward stops matching the previous cache unit. A regenerate would re-price far more than the
turn it replaces. Omitting the final cue instead shifts nothing — the earlier messages keep their
indices and still hit (measured: 1920 hit tokens).

**Lower or raise the temperature for a regenerate.** Rejected: sampling settings are the writer's
per-turn overrides, and changing them per verb would make a swipe un-reproducible. Variety across
swipes is what sampling already provides.

## Consequences

- **A regenerate no longer steers at all.** It draws again from the same context, so two swipes may
  converge at low temperature. That is sampling, not a bug.
- **`targetWords` does not apply to a regenerate.** There is no cue to carry it; the model draws at
  its own length. The override still governs `send` and `continue`.
- **An older turn can be regenerated honestly now.** Its variant is a real alternative for that
  position; the later turns stay in the transcript untouched and are simply not part of the request.
- **Regenerate's payload is one message shorter** than a normal turn when the tail is empty, and the
  message indices of everything before it are unchanged — so the shared prefix is not disturbed, and
  the next `send`/`continue` still compares against aligned indices.
- **The no-final-cue shape is now a real payload shape**, so the composer's old invariant ("a
  request that ends on a system message is avoided") is retired: a regenerate may end on the
  transcript `user` message, or on the volatile-tail `system` message when there is one.

## Verification

- `npm run verify:store` — **189/189**, with four new payload checks: a regenerate keeps only what
  came before its turn (`FIRST BEAT` and a later `SECOND BEAT` both absent, the earlier user turn
  present); no wire message carries a per-turn cue; the `instruct` block carries no generated
  clause; and a plain `continue` still carries both the transcript and its cue.
- **Payload shape for the live Augusta story**: `roles: ["system","system","user"]`, last message
  the transcript, `instruct` block `null`.
- **A real regenerate against a copy of the live database** (DeepSeek, off-peak) returned no error
  and no mention of rewriting or continuing: the reasoning opens *"Hmm, the user is continuing this
  roleplay scene where Navid, as Donovan, is kneeling before Augusta…"*, the turn added a fresh
  variant, and it cost **$0.000319 at 1920 hit / 218 miss**.
- `npm run verify:cache` — **85.7% (5632 hit / 939 miss)**, drift 10.3pt, in line with the
  previous runs: `send` and `continue` payloads are byte-identical, because their cue and final
  user message are untouched.
- `npx tsc --noEmit` and `npm run verify:notes` clean.
