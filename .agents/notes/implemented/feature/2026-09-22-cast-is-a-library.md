# Agent Note: The cast is a library

Status: implemented

## Problem

A story's cast *was* its rows: `characters.story_id` was `NOT NULL REFERENCES
stories(id) ON DELETE CASCADE`, `castOf(story)` was `characters.list(story.id)`, and the Cast
page rendered the open story's bundle. Three consequences followed, and all three were wrong
in the same direction:

- **A new story opened on an empty cast** with no way to reach anyone written in another
  story. Casting Cantarella in a second story meant retyping her card.
- **A character could belong to exactly one story.** The same person in two worlds was two
  drifting definitions, so an edit fixed one and left the other stale.
- **Deleting a story deleted its people.** The cascade ran story → `characters` → `stories`
  (the chat), so a delete took conversations with it — named in the confirm, but taken.

The roster read as a property of the world. It is not: a *scene*, a memory, a directive block
belongs to one story. A character is a person the writer reuses, and the app already had the
right shape for that everywhere else — a chat borrows its card, every reader of a story sees
the same one definition. The cast was the one place that rule was not applied.

This reverses two decisions recorded earlier: the [cast page
note](2026-09-22-cast-page-not-a-dialog.md) rejected "a cross-story character library" as
out of scope, and the [character chats
note](2026-09-22-character-chats-are-stories.md) built on "a character is a row owned by
exactly one story" plus the two-hop cascade. Both notes are updated to the new facts; their
own decisions (a page rather than a dialog; a chat is a story) still stand.

## Decision

**A character is a library object with a home story, cast into one or more stories by
reference.**

- **Two tables, two questions.** `characters.home_story_id` (nullable, `ON DELETE SET NULL`)
  says where a card was written. `story_cast(story_id, character_id, sort_order)` says whose
  payload it is in. `castOf(story)` reads the membership; a chat still reads its one
  `character_id`, and gets no membership row, because a second source for that fact would be
  the first thing to drift.
- **Creation casts; adoption references.** `characters.create` writes the card and its home
  membership, so a new card appears in its own story exactly as before. `POST
  /stories/:id/cast` adds an existing card to another story — the same row, not a copy — and
  `DELETE /stories/:id/cast/:characterId` takes it out again. The home story's own membership
  cannot be detached: that is a delete, and there is a control for it.
- **The Cast page has two scopes.** `This story` is the payload roster (unchanged, with its
  token total). `Library` is every character, grouped by home story, which is where a blank
  story acquires a cast. Personas are deliberately absent from `Library`: a persona is the
  writer's mask *for a story*, and `is_default` is a per-pool flag that a shared pool has no
  meaning for.
- **Deleting a story keeps what it authored.** Cards survive with `home_story_id = NULL`, and
  their conversations survive too: the borrowed persona is copied into the chat before the
  story goes (`freezePersonaInto`), so the persona block and every `{{user}}` in the payload
  keep resolving. The FK cascade now stops at the story's own rows — cast, personas, scenes,
  messages, memories, lore, threads, notes, prefixes, warm-up.
- **A card that outlived its home is still usable.** It can be cast and edited anywhere; to
  start a *new* chat it needs a story that casts it (`fromStoryId`), which lends its world, and
  the chat freezes the persona at creation. Without one the route answers 409 with that fix
  rather than opening a conversation whose `{{user}}` would silently become "Player".
- **The wire contract grew three things:** `GET /api/characters` returns `CastIndex`
  (`characters` + every membership), `POST|DELETE /api/stories/:id/cast(/:characterId)`, and
  the two delete responses now report what survives — `DELETE /stories/:id` returns the card
  names and conversation titles it kept, `DELETE /characters/:id` returns the `storyIds` it is
  leaving, read before the cascade.

**Migration.** `story_id` is copied into an additive `home_story_id`, then the old column is
dropped — dropping and re-adding a column under the same name is how a database loses every
character's story without ever failing, so the copy is load-bearing and `verify:store` pins
it. The membership backfill carries `sort_order` across, which is what keeps an existing
story's cast block **byte-identical**: order is bytes in the cache prefix.

## Verification

- `npm run verify:store` — **121/121**, including: a second story adopts a card without moving
  it, adoption is idempotent, an edit reaches every cast, a later member appends, detaching
  removes exactly one card and leaves the home cast alone; deleting a story reports the cards
  and conversations it kept, the card survives with a null home, the chat survives with its
  transcript and exactly one frozen persona whose text matches what was borrowed; a story with
  no cards, and a story whose cards have no chat, both delete cleanly; a home-less card refuses
  a chat on its own and in a story that does not cast it, and starts one — with the persona
  frozen — in a story that does. A hand-built v1 file is opened by the real `openDatabase`:
  the home value and the card order survive, `story_id` is gone, the FK is `SET NULL`, the
  membership is backfilled, `PRAGMA foreign_key_check` is empty — and a second open is a no-op,
  which is what stops the migration corrupting the file on every boot after the first.
- `npm run verify:tx` passes unchanged; `npm run verify:notes` conforms; `tsc --noEmit` clean.
- **Against a copy of the real database** (4 cards, 1 chat, 3 stories), the migration kept
  every `home_story_id` and the cast order `Cantarella Fisalia#0 … New character#3`, and every
  changed route was exercised including its error paths: adopt 200 / again 200 / unknown card
  404 / missing field 400; detach 200, twice 404, wrong story 404, home card 400; chat 200,
  again 409 with the title, into a chat 400; delete story 200 `{characters:[…],chats:[…]}` with
  the card home-null and the chat's pool holding `The Mask`; delete card 200 with its
  `storyIds`.
- **The payload did not move.** A probe composing the cache-verify story ran against `HEAD`
  and against this change in a detached worktree: identical `total 1861`, identical block
  tokens (`cast:120`, …, `instruct:12`) and identical message lengths. Adoption is the only
  thing that changes a cast block, and it changes it the way the writer asked.
- **Adoption and rescue reach the payload, not just the endpoints.** `POST /api/plan` on a
  blank story before/after adopting reports the cast block gaining the card (79 tok, carrying
  its name); the same call on a conversation whose world was deleted reports
  `persona:13` — `"## Player character A tide-watcher with salt in her hair."` — i.e. the
  frozen persona, not an empty block.
- **In the browser**, on that same copy: a blank story's Cast page says *"No one is cast in
  this story yet"* with a **Browse your 4 characters** control, which opens the roster grouped
  by home story; adding swaps the card's control to `Remove` and the band to
  `2 cards · 3 tokens in the prefix`; the adopted card then appears in the payload rail's Cast
  section; removing it restores the empty cast. The story-delete confirm says the characters
  stay in the library and the conversations keep their transcript; the card-delete confirm
  names the *other* story whose cast it leaves. Zero console or network errors, and
  `scrollWidth === clientWidth` with zero card/footer overflow at 320/360/390/430/768/1024/1280/
  1440/1920 in both scopes.
- `npm run verify:cache` — **86.2% overall (5632 hit / 900 miss), worst drift 9.6pt** after the
  cold turn, reproduced twice. Because the payload is byte-identical to `HEAD` (above), this is
  the *meter* against the API's cache granularity, not a regression: the API served exactly
  1920 hit tokens (= 30 × 64) on both turns while the predicted stable prefix crossed a
  64-token boundary. Recorded here as an open observation about drift, not fixed in this change.

## Alternatives considered

**Copy the card into the adopting story.** Rejected for the reason the character-chats note
already rejected it for a chat: two definitions of one person drift, and the writer edits one
and keeps performing with the older. Import and story duplication are copies because they
produce an independent bundle; casting is a relationship, not a bundle.

**Re-home the card (move it) when a story adopts it.** Rejected: `homeStoryId` is also where a
chat draws its persona pool and its world seed, so moving a card would silently re-point a live
conversation's `{{user}}` at another story's pool. Adoption has to be additive to be safe.

**Delete the conversations when their world is deleted.** The simplest rule, and it was on the
table: cards survive, chats go, and the confirm already names them. Rejected because it
destroys the writer's prose as a side effect of deleting something that is not the prose. The
freeze preserves it, and copying the persona is only the wrong move while a *second live
definition* exists — here the pool is gone, so there is nothing to drift from.

**Keep the chat borrowing a persona pool after its world is gone.** Not possible: the pool
cascades with the story. Freezing is the only way to keep `{{user}}` resolving, and the
alternative — a chat that sends no persona block — silently renames every turn the writer ever
wrote to "Player".

**Give every chat its own persona up front.** Rejected in the character-chats note and still
rejected: it makes "who I am" a per-conversation copy, so editing a persona in one chat leaves
every other one stale. Borrowing stays the norm and freezing is the exception, taken only when
the pool ceases to exist.

**Make personas library objects too.** Deferred a second time, for the reason recorded the
first: `is_default` is a property of a *pool*, so a shared persona has no defined default and
every story would need a selection rule. The same request now has a precedent and a smaller
shape (this release's `story_cast`), which is exactly why it is worth leaving to its own note
rather than smuggling it in beside characters.

**Rebuild the `characters` table to rename the column in place.** Rejected in favour of the
additive add-copy-drop: SQLite's `ALTER TABLE … RENAME` also rewrites references to the table in
other schemas, and `stories.character_id` is a real FK onto `characters` that must not be
touched. `ADD COLUMN` then `DROP COLUMN` is smaller, and its only hazard — the copy — is the
line the suite now guards.

**A `story_cast` row for a chat's card.** Rejected as redundant state. A chat's cast *is*
`stories.character_id`; a membership row would be a second answer to the same question, and
`castOf` would have to choose between them.

## Consequences

- **A card can be cast in many stories, so one edit reprices all of them.** Editing a card
  changes the `cast` block of every story that casts it, and everything behind that block
  re-misses once on the next turn. That is the honest cost of one definition, and the roster
  already states each card's weight in the prefix.
- **Deleting a story is strictly less destructive than it was.** The confirm and the toast now
  say what was *kept* — the characters, and the conversations with their persona frozen — and
  the writer learns that a delete can shrink a *different* story's cast only from the card's own
  delete confirm, which names those stories.
- **A chat's persona invariant is amended, not broken.** "A chat owns no personas" holds while
  its world exists; after the world goes the chat owns exactly the one it was using. That is
  visible in the store and pinned by name, because a reader who knows the old invariant would
  otherwise treat a chat's own persona row as a bug.
- **A card can outlive its home story.** `homeStoryId === null` is a real state: castable,
  editable, chattable from a story that casts it — and with the Chat control disabled wherever
  no such story is open, rather than a button that 409s.
- **`story_cast` now decides a story's cast, and `characters.sort_order` only orders the home
  cast** (and seeds the backfill). Cast order is per membership, so `{{char}}` is the first row
  of *this* story's cast, which is what a second story's append should mean.
- **The Cast page no longer assumes a story.** `Library` works with nothing open — the page
  reads `/api/characters` rather than the bundle — so its "open a story first" branch is gone
  and its band hint is scope-aware: the story scope totals the prefix, the library scope counts
  characters and stories and states no token total that is not in an open payload.
- **A detached card's turns keep their speaker name but lose the portrait**, because
  `resolveSpeaker` matches the cast for the face and falls back to initials. Accepted: the
  transcript is text, and re-attaching restores the face.
