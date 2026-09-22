# Agent Note: The creation assistant page is a chat surface

Status: implemented

## Problem

The creation assistant's premise is that a writer *talks* to it. Its thread was already persisted
and reloadable, and a follow-up could already say "the second one" — but the page it lived on
contradicted all of it. The ask was a three-row textarea in a card with the target picker and the
consent checkbox above it, the starters sat under the form, and the stored conversation was a flat
log under that: an eyebrow and a paragraph per row, no bubble, no avatar, no speaker line. The
writer's own turn was not drawn as a turn at all; it was two fields of text under a rule.

Two costs, and the second is the one that matters:

- **It read as a form.** A form says *fill this in and submit*. The design says *say something and
  it answers*. Every element on the page — a labelled picker, a boxed textarea, a filled Build it
  button, a consent checkbox — was the vocabulary of a submission, so the first impression was of
  an operation to run and not a conversation to have.
- **It was the only surface in the studio that did not look like a conversation.** Narration renders
  as bubbles with a speaker's name and an avatar ([the disclosure
  note](2026-09-22-progressive-disclosure-of-instrumentation.md) settled that). The assistant
  answered in the same register as the narrator and was drawn completely differently, which made the
  assistant read as a tool *about* the writing rather than as a participant in it.

The measurements were never the problem. Nothing about the page was unclear; it was the shape that
was wrong.

## Decision

**The page is the studio's chat: the thread is the page, bubbles on both sides, the composer pinned
at the bottom.** The decision to keep this page — its persisted thread, its explicit target, its
receipts, its stop semantics — stands unchanged; this records what it looks like.

- **Both sides are bubbles, with the same anatomy as the transcript.** The writer aligns right in
  `bubble-user` under a "You" name line; the assistant aligns left in `bubble-narrator` under a
  "Creation assistant" name line, marked with the studio's feather on the avatar circle's grid
  rather than a photo of a person. It is not the narrator — different mark, different label — and it
  is not a person.
- **The composer owns the two parameters.** The target picker and the rewrite consent moved out of
  the card and down beside the input, where a persona or an author note lives on the narration
  surface, because both are properties of the message being sent rather than of the chat. The target
  control keeps its icon, its `title`, and its sentence in the footer for the writer who wonders
  what "no story" will do. The consent checkbox says "Allow rewriting" and carries the prefix
  consequence in its `title` instead of a permanent paragraph.
- **The opening is the assistant's first turn.** A greeting bubble — the same shape every later
  answer arrives in — says what the assistant does and where "Write into" is, with the asks it is
  good at offered as chips underneath. The chips draft the request into the composer rather than
  sending it, because the interesting part of "four lore entries" is the details a writer adds
  before pressing Enter.
- **The receipt is the accounting, one action away.** Cost, token counts and the per-row chips moved
  inside a `Receipt` disclosure whose summary keeps what a writer acts on: how many rows moved, how
  many blocks were rewritten, how many targets were refused, and the turn's cost. A turn that
  changed something opens its receipt by default — a write that re-prices the prefix must never be
  invisible. A turn that only answered leaves it folded, because there is nothing behind it to see.
- **Prefix movement became its own disclosure.** The "prefix moved" card keeps its count and its
  `Warm it` button in the summary line; the block names and token counts sit inside it, because
  which blocks moved is the detail and *that* something moved is the fact.

## Alternatives considered

**Keep the form and only convert the thread into bubbles.** Rejected: the request was the surface,
not the log. A bubble transcript under a submission form is two interfaces stacked, and the writer
still starts by filling something in.

**Keep the target picker as a labelled field above the composer.** Rejected on the strength of the
same reading: labelled fields above an input are how a form announces itself. The cost of moving it
is that the picker's explanatory sentence has to live in the footer and its `title` — accepted,
because the picker is four words and a story title, and the explanation is only wanted once.

**Fold the target picker into a mode chip inside the composer's toolbar.** Deferred, not rejected:
it would hide the target behind an interaction and make "which world may this touch" something the
writer has to go looking for, which is worse than one visible control.

**Give the assistant an Avatar with initials ("CA") like a character.** Rejected: a circle with
letters reads as a person, and the initials do not match the speaker's name. The feather is the mark
the studio already uses for the writer's own instrument, and it distinguishes the assistant from the
narrator without inventing a face.

**Put the whole receipt inside the disclosure, including the "wrote 3 rows" summary.** Rejected: a
folded line that says nothing is a control nobody opens, and the summary line is where the row count
and the cost earn their place.

**Print cost and token counts in the bubble's footer, as the narration transcript covers in `Turn
details`.** Rejected for the same reason the narration transcript rejected it: a bubble that
advertises its price is a bubble you cannot get lost in. The figure lives in the receipt and in the
band.

## Consequences

- **The page is one column with two regions, and the thread scrolls.** It inherits the transcript's
  stick policy — auto-scroll only while the writer is already at the end, with a "Latest message"
  control once they scroll up — so a long conversation is not dragged out from under someone reading
  back. This is the first page outside the transcript to carry that policy.
- **`PageBand.hint` now accepts a node**, because the band has one line and a phone's line does not
  fit `1 turn · $0.00069 · no story selected`. The cost is dropped below `sm`; the turn count and
  the target stay, because those are what the writer reads.
- **A message's target is read from the message, never from the picker.** The recorded target can
  have been re-pointed since, so the receipt line says where that turn actually wrote — and a target
  whose story has since been deleted says "into a story since deleted", which is a third state and
  not the same fact as "no story selected".
- **Receipts can be long.** A revision row lists up to seven changed fields and a refusal can be a
  sentence, so both the field list and the row columns truncate rather than push the bubble past the
  screen. This was a real overflow at 320–430px until the field column was allowed to shrink.
- **The empty state is a turn.** Anyone who wants the page to open with a form now finds a
  conversation instead; the starters are the way in, and they are chips in the thread rather than
  buttons under a box.
- **Nothing about the turn changed.** No store, route, agent, prompt, or receipt field was touched:
  this is presentation, and the payload the assistant re-prices is exactly what it was.

## Testing

`npm run typecheck`, `npm run verify:store` (131/131), `npm run verify:tx` and `npm run verify:notes`
all pass. The surface was verified in a browser against the running app, at nine widths from 320px
to 1920px: zero horizontal overflow and zero application console errors at every one, measured as
`documentElement.scrollWidth === clientWidth` rather than judged from a screenshot. A real assistant
turn was sent — one library character, $0.00069 — and its user bubble, answer bubble, feather mark
and open receipt were read back from the DOM. A mocked seven-message thread drove the rest: three
user bubbles and four assistant bubbles, four receipts, one open by default for the write and folded
for the turn that only answered, plus a `New chat` that emptied the thread to the opening greeting,
a starter that drafted into the composer without sending, and a mocked plan that produced the
prefix-moved disclosure. The long-name stress case (a 115-character character name and a seven-field
revision) is what surfaced the field-column overflow, which now measures zero at all nine widths.
