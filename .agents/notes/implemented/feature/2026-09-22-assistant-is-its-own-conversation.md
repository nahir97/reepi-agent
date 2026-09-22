# Agent Note: The assistant is its own conversation, with an explicit target

Status: implemented

## Problem

The creation assistant shipped twice in one day, and the first shape had two defects that only
became obvious once it existed.

**Its conversation was session-only.** The thread lived in the zustand store, and the page sent it
back to the server as bounded `history` so a follow-up could say "the second one". Reload and the
conversation was gone — while everything it had *made* stayed. That is the right bargain for a
Director call, whose conversation is an implementation detail, and the wrong one for a surface whose
whole point is that a writer talks to it. A chat that forgets is a form with extra steps.

**Its write target was implicit.** The pass wrote into `activeStoryId` — whichever story happened to
be open. Two failures hid in that:

- A writer could ask the assistant for a lorebook and have it land in a story they had forgotten was
  open. The receipt said where it went, but the *decision* was made for them by the UI's selection.
- With no story open, the assistant had almost nothing to do. Cards required a home story
  (`characters.create(homeStoryId)`), lore and blocks are story-scoped, so a new writer's first
  interaction with the assistant could only produce an app-scoped template or a whole new story.

**And it was reachable in the wrong order.** It was a page behind the studio list, above a story
list that had to exist before anything it did was useful.

## Decision

**The assistant is an app-scoped conversation with a persisted thread, an explicit write target, and
the ability to write characters that belong to no story yet.** Supersedes the conversation-home and
target paragraphs of
[the creation assistant](2026-09-22-creative-creation-assistant.md); the tool surface, the block
consent rule, the receipt and the single-transaction apply all stand unchanged.

- **A table, not a page's memory.** `creator_messages` holds one row per message, app-scoped, with no
  foreign keys and no story id of its own — nothing in it is ever read by the composer, and deleting
  a story must not rewrite the conversation that described it. An assistant row carries its whole
  receipt as JSON, so a receipt read back a week later says what the turn did *and* what it was
  allowed to do (`allowOverwrite`, the target) rather than being re-derived from state that has since
  changed. The reader orders by `created_at, rowid`: a turn's two rows can share a millisecond, and
  an ask and its answer must never come back swapped.
- **Three verbs, one thread.** `GET /api/creator/messages`, `POST /api/creator` (which records both
  messages or neither), `DELETE /api/creator/messages` for "New chat" — the conversation goes,
  everything it wrote stays. One chat, not many: multiple named threads would be a second
  organisational surface to design, and nothing yet needs one.
- **The target is a parameter the writer sets.** A labelled "Write into" control, defaulting to *no
  story*. `targetStoryId: null` is a legitimate way to work: characters become library cards with no
  home, templates are app-wide, and a story can be created by the turn itself. A turn that created a
  story becomes the target for the next one, because the writer just asked for that world; nothing
  else selects it, and the page no longer reads `activeStoryId` at all.
- **Floating cards.** `characters.create` accepts a null home and writes one row instead of two: a
  card with no world and no cast, which any story can adopt later. The state is not new — it is
  exactly what a card becomes when the story that authored it is deleted, and the cast page already
  renders it as "no home story" — so the assistant is now useful *before* a story exists. Adoption
  still does not re-home a card: casting a floating character into a story is a membership, and her
  card stays hers.
- **History is read back, not sent in.** The pass is shown the last few stored exchanges instead of a
  client-supplied `history` array, so the model's memory of the conversation is the same thing the
  writer can see, and a reloaded page cannot lose the context a follow-up depends on. It also
  removes the last piece of untrusted input from the request.
- **Stopping is a first-class outcome.** The route ties an `AbortController` to the client hanging up,
  the page has a Stop control, and a stopped turn answers `{ aborted: true, turn: null }` — a 200,
  because the writer asked for it. Nothing is written and nothing is recorded: a stopped turn is not
  part of the conversation. The ask stays in the box, because the sentence they typed is the one
  thing an abort must not cost them.
- **It is in the library rail, above the stories.** Its own row, always in the same place, marked
  active like a story row — but *not* inside the story list. It is a conversation, and it is not a
  story; filing it among them would be a claim about it that is not true. A first-run writer gets a
  button to it too, because with nothing open it is the one surface that still works.

## Alternatives considered

**Keep the session-only log and only make it app-scoped.** Rejected: it is the cheaper change and it
leaves the defect that matters. The assistant's value is a conversation that accumulates — "make the
second one older", "now open a story for her" — and both of those depend on the earlier turn still
existing. The precedent it was copied from (agent output is durable, agent conversations are not) is
about *passes*, not about a surface the writer talks to.

**Let the implicit target stand and only fix persistence.** Rejected as the more dangerous half. A
chat with memory that can silently write into a world you are not looking at is worse than one that
forgets, because the surprise compounds.

**Take the target from the selected story in the library rail.** Rejected: it makes the two surfaces
coupled in a way neither can explain — switching stories to read one would silently re-point the
assistant.

**Resolve the target from the request text.** Rejected for the picker: the model would be doing the
matching, and a mis-resolved story is a write into the wrong world. It can still be added later as a
convenience layered on the explicit parameter, never as a replacement for it.

**Require a story for every character.** Rejected: it is the one thing that made the assistant
useless to a writer who has not started yet, and the schema already had the state needed to do
better.

**Multiple named assistant threads.** Deferred, not rejected. One chat is what the surface needs
now; a `thread_id` column would be the additive migration if that changes.

**Persist only the receipts, not the writer's asks.** Rejected: a receipt with no question above it
is not a conversation, and the page would have to invent a summary of what was asked.

## Consequences

- **A second app-scoped table, and one more DAO.** `verify:store` now covers it: the thread round-trip,
  the receipt as data, and the app-scoped-ness (clearing a chat leaves the cards and stories alone).
- **`characters.create` takes a nullable home**, and writes no cast row in that case. Callers that
  always have a story are unaffected; the orphan state that used to be reachable only by deleting a
  story is now a normal way to write a card.
- **The receipt is historical data.** A receipt no longer describes the live row it names — someone
  may have edited the card since. That is the point (it is what happened), and the page says so by
  reading the receipt from the message rather than re-deriving it from the bundle.
- **One more surface in the rail**, and the first-run screen can now be left without creating a story.
- **The stopped turn's spend is unrecorded.** An aborted round never reaches `recordSideCall`, so its
  real cost is not in the ledger. That gap is shared with an aborted narration turn and is not
  introduced here; recording a cost for a call whose usage never arrived would be inventing a number.
- **A floating card cannot start its own chat.** `startChat` needs a world to draw from, so a
  character with no home story has to be cast somewhere before she can be talked to. That is the
  existing rule for cards that outlived their home, and the cast page already explains it.

## Testing

`npm run typecheck`, `npm run verify:notes`, `npm run verify:store` (131 checks, ten of them new for
the thread and the floating card) and `npm run verify:tx` all pass. A throwaway probe drove the real
dispatcher and the real apply path for 31 checks, including the four this design adds: a character
written with no story becomes a card with no home and no cast row; the library is the namespace when
no story is selected, so a duplicate name is refused; a library card can be revised from an
app-scoped chat and adopted into a story; and a mid-batch failure still rolls the story and its cast
back. Live against a scratch database: a floating character written with no target, a follow-up that
resolved "her" from the stored thread and created a story with six lore entries and a cast, a
disconnected client leaving the thread unchanged at four rows and the story's lore unchanged at six,
and a "New chat" that emptied the thread while the card, the story and its six entries stayed.
Browser: the rail row, the target picker defaulting to *no story*, the stored receipts (including
`added to cast`), zero overflow at 1280/1024/768/430/390/360/320 and no application console errors.
