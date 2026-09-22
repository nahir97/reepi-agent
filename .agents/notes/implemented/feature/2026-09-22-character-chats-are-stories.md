# Agent Note: A character chat is a story

Status: implemented

## Problem

The cast page was a roster you could only edit. Every card's one action was `Edit`, so the
answer to "I want to talk to Cantarella" was a form. The product is roleplay — talking to a
character *is* the feature — and the roster was the one surface where a character was in front
of you with nothing to do.

The hard part was not the button. It was where a 1:1 conversation *lives*, because Reepi's unit
of work is the story: it owns the transcript, the cache prefix, the persona, the cost ledger,
the scenes and the memories. A character, meanwhile, is content the writer reuses — one
definition, priced into every prefix it is cast into
([the cast is a library](2026-09-22-cast-is-a-library.md) made that a row in `story_cast`
rather than a `story_id`).

So the question is what an "isolated chat with one character" **is**, in a product whose only
session-shaped object is a story.

## Decision

**A character chat is an ordinary story with `stories.character_id` set.** That single column
is the whole link, and everything else about a chat is borrowed or derived:

- **Cast: one borrowed card.** `castOf(story)` returns the referenced card for a chat and the
  story's `story_cast` rows otherwise. The character stays one definition — editing the card
  anywhere edits the card everywhere, and the chat re-prices next turn.
- **Persona pool: borrowed too.** `personaPoolOf(story)` is the pool of the story the card was
  written in — its home. A chat owns no personas, so the writer's identity is one card rather
  than one per conversation, and "switch who I am" is a selection rather than a copy. *(The one
  exception: when that home story is deleted, the persona the chat was using is copied into the
  chat, because there is no pool left to borrow. See
  [the cast is a library](2026-09-22-cast-is-a-library.md).)*
- **Seed: the world, never the transcript.** Starting a chat copies the directive blocks
  (contract, genre, style, bible, scenario, exemplars), the writing settings (model, effort,
  sampling, budgets, prefill, theme) and the **anchored** lore, then seeds the card's greeting
  as the opening turn. Turns, memories, threads, notes and synopsis do not come along;
  `instruct` does not either, because it is a directive about the turn being written rather
  than a fact about the world.
- **One chat per character**, enforced twice: `startChat` hands back the existing chat instead
  of creating a second, and a partial unique index (`stories_character_id … WHERE character_id
  IS NOT NULL`) makes a second row impossible even under a race.
- **`ON DELETE CASCADE` on the card, deliberately.** `character_id` is a real foreign key, so
  deleting the *card* deletes the chat and its children, and the delete response names the
  conversation before the writer agrees. Deleting the *story* no longer does: its cards survive
  with a null home and its conversations survive with their persona frozen, both reported
  ([the cast is a library](2026-09-22-cast-is-a-library.md)).
- **The composer can change persona mid-chat.** The persona block is volatility 2, so a switch
  invalidates that block and everything behind it — the cast and the world in front of it stay
  cached. The chip states that trade in one line rather than hiding it behind a confirm, and
  the meter then shows the real number on the next turn. This was an explicit product call:
  ease over the cache, since the cache is a means and not the product.
- **Chats are conversations, so they list in the library** with a `chat` chip, and every story
  surface works inside one unchanged — scenes, inspector, cost ledger, settings, export.
- **Assistant turns in a chat wear the card.** `narratorSpeaker(story)` attributes them to the
  one character, because in a 1:1 chat the narrator *is* the character; an ensemble story still
  leaves them unattributed for the writer to re-attribute.

The API is two changes: `POST /api/characters/:id/chat` (open-or-create; 409 with the existing
chat's title when there is one), and the routes that resolve a story's cast or persona pool go
through the same helpers the composer does — `GET /stories/:id/characters`,
`GET /stories/:id/personas`, `POST /stories/:id/personas`. A chat refuses to create a second
character (`400`) and refuses an added cast member (`400`,
[the cast is a library](2026-09-22-cast-is-a-library.md)), because either row would be
invisible to the composer that resolves the cast.

## Verification

- `npm run verify:store` — **121/121**, including the chat cases: a chat borrows exactly one
  card, borrows the home persona pool while owning no persona rows, seeds the greeting,
  copies anchored lore only, refuses a second chat through the unique index, and — since
  [the cast is a library](2026-09-22-cast-is-a-library.md) — survives the deletion of the story
  it was seeded from with its transcript and its persona frozen in.
- `npm run verify:tx` — unchanged and passing; chat creation is a multi-row transaction.
- `npm run verify:cache` — **88.0% overall hit rate** (5760 hit / 788 miss), worst prediction
  drift 4.7pt after the cold turn, i.e. the normal-story composer path is unaffected by the
  cast/persona refactor.
- A throwaway live run against a real chat (four turns, real API, real prefixes) measured the
  claim this note makes about switching: with the payload growing from 898 to 1354 tokens, the
  **hit tokens stayed at 768** — the frozen prefix in front of the persona block — while the
  switch turn re-missed from `persona` onwards (`changed: persona, history`; 56.3% that turn)
  and the next turn settled (`changed: history`; 83.0%, drift -3.0pt). A chat payload reported
  exactly one cast card on every turn.
- In the browser: a card click opened the chat and the composer in one gesture; the pencil
  opened the editor; `Chat` on a new card created and opened its conversation; the persona chip
  switched and a real turn was written as that persona, with the reply attributed to the card;
  deleting the card named the chat in the confirm and removed the library row.
- `document.documentElement.scrollWidth === clientWidth` at 320/360/390/430/768/1024/1280/
  1440/1920, and the composer's control row reported zero inner overflow at all nine — the
  persona chip is `shrink-0` inside a `flex-wrap` row precisely because it was squeezed under
  its own label at 320 before that (20px overflow, measured).
- Zero console errors. `npx tsc --noEmit` and `npx vite build` clean.

## Alternatives considered

**A scene inside the story, focused on one character.** The cheapest thing to build — the
transcript surface already filters by scene, and a `scene.focus_character_id` would narrow the
cast block for those turns. Rejected because "isolated" would be a lie: the payload still
carries the story's bible, memories, lore, synopsis and cost history, and the chat would share
one cache prefix with the group narrative it is supposed to be separate from. A scene is a beat
of the story; a chat is a different session.

**The chat owns a copy of the card.** Rejected on drift: the roster and the chat would hold two
definitions of one character, and the writer would edit the card in one place and keep talking
to the older version in the other. Copying is right for `Duplicate story` and for import, which
produce an independent bundle; a chat is a relationship to an existing card, not a copy of it.

**Copying the persona pool into each chat.** Rejected for the same reason, with a worse
failure: a persona is the writer's identity, so editing it inside one chat would leave every
other chat on a stale version, and starting a second chat would silently discard the edit.
Borrowing the pool means one persona everywhere — and gives the mid-chat switcher a list to
switch among.

**A studio-wide persona library.** The honest long-term version of the same idea: personas live
above stories, and every story references them. Deferred, not rejected — it is a schema
decision in its own right (a persona table with no owning story changes what deleting a story
means, and `is_default` is a property of a pool rather than of a persona), and the
borrowed-pool arrangement already gives one persona across every chat started from a story.
[The cast is a library](2026-09-22-cast-is-a-library.md) built exactly this shape for
*characters* and deliberately left personas out; the deferral now has a precedent to copy.

**A `kind` column alongside `character_id`.** Rejected as redundant state: a chat *is* a story
whose `character_id` is set, and every reader that needs to distinguish them can ask that. A
`kind` column would be a second source of truth for the same fact, and the first one to drift.

**A panel, drawer or dialog for the chat.** Rejected by the same argument as the cast page
itself: a conversation is not a thing you close. A chat is a place you are in, with its own
transcript, so it is a story in the centre column.

**Many chats per character (a chat list per card).** Deferred. It is one index away — drop
`stories_character_id` (in the migration list, not just the DDL), let `startChat` always create,
and give the cast card a chat list instead of `Open chat` — but the request was "its own chat",
and a card whose click opens *which* chat is a question the current UI has no good answer for.
Recorded here so the next reader does not have to re-derive the reversal.

**Putting `characterId` in the story patch sanitiser.** Rejected: the reference is set once by
the one write path that can validate a card id (`startChat`), and a client that could re-point a
chat's card could point it at a card in another story with no cascade guard.

## Consequences

- **A persona switch costs a real re-read, and the app says so.** Measured: the frozen prefix
  (contract → cast) keeps hitting while everything from the persona block on re-misses once,
  then caches again. The write is immediate and the disclosure is one muted line in the menu.
- **The borrowed pool has a sharp edge:** editing a persona from inside a chat edits the shared
  card, and therefore changes the source story's next payload too. That is the intended
  consequence of "one definition", and it is legible because the same card is listed in both
  places. The edge stops at the source story's deletion: the chat keeps the persona it was
  using ([the cast is a library](2026-09-22-cast-is-a-library.md)).
- **Deleting a card can delete a conversation**, which is why that delete path returns the
  affected chat titles and the client names them in the confirm. Silent loss would have been the
  real cost of the cascade. Deleting a *story* no longer can: the card survives it and the chat
  survives with its persona frozen, both reported.
- **One cascade hop is load-bearing** — `characters → stories` (deleting the card deletes its
  chat) — and `verify:store` pins it, because it is invisible from the schema of either table
  alone. The second hop (`stories → characters → stories`) is deliberately gone: it was the
  mechanism that made a story's delete take the writer's people with it.
- **Duplicating or exporting a chat produces a standalone story.** `insertBundle` nulls
  `characterId` on every copy, so the branch/export carries a real copy of the card. A chat is
  not exportable as a chat, and that is the honest unit: the reference means nothing outside
  the database that holds both rows.
- **The chat inherits the source theme**, so the library portrait is the character's initial on
  the world's ground rather than a face. Using `cover` for the avatar was considered and
  skipped: no UI writes `cover`, and denormalising an avatar into it would go stale the first
  time the card's portrait changed.
- **`CastPage` now has two card shapes** — a single button that opens the editor, and a card
  split into a chat body plus a footer with `Chat`/`Open chat` and a pencil. A card with two
  actions cannot be one button, and the pencil is dim rather than hover-revealed so touch keeps
  it.
