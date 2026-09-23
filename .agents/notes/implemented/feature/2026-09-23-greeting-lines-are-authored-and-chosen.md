# Agent Note: Greeting lines are authored on the card and chosen when a chat starts

Status: implemented

## Problem

Reepi could already *open* a chat on a greeting: an imported card's `first_mes` was seeded as the
opening assistant turn, and `startChat` had done that since character chats shipped
([a character chat is a story](2026-09-22-character-chats-are-stories.md)). But nothing in the
app could *write* one. The card editor exposed the fields that render into the cast block — name,
tagline, description, personality, speech, scenario, example dialogue, portrait — and no field
for the line the character actually says first. Every character authored here therefore opened a
conversation on an empty page, and the only route to a greeting was to import a SillyTavern card
that already had one. The product's central roleplay gesture depended on a file from another
program.

Imported cards also carry `alternate_greetings`. Reepi stored them in `Character.meta`, preserved
them across an export, and never offered them: a writer could not choose which opening a
conversation began on, and an alternate was data the app round-tripped but could not reach.

## Decision

**A greeting is card data, stored where the importer already put it, and one browser-safe module
reads and writes it.**

- `src/shared/greetings.ts` is the single definition: `greetingOf` (the opening line),
  `greetingSlotsOf` (raw slots, blanks preserved — the editor's view), `greetingsOf` (usable
  greetings, blanks dropped, opening first — **the list an index refers to**), and
  `withOpening` / `withAlternates` (one-key `meta` patches). The storage keys are
  `meta.first_mes` and `meta.alternate_greetings`, exactly as `cardToCharacter` writes them.
- **The card editor gains an Opening section**: an opening message field, plus a repeatable list
  of alternates with add/remove. It states the two surprising facts beside the fields — a
  greeting never enters the cast block, so editing it cannot re-price an existing prefix; and it
  is written once into a *new* chat, so a chat that has already started keeps the line it opened
  on.
- **Starting a chat takes an optional greeting index.** `POST /characters/:id/chat` accepts
  `{ greeting }`, an index into `greetingsOf`; `openChat` seeds that line, expanding its macros
  once against the new chat's own context (unchanged from before). An index that no longer
  resolves falls back to the opening line, and a card with no greeting seeds nothing so the chat
  opens blank. The index is validated — anything that is not a whole number `≥ 0` is a `400` —
  rather than coerced, because rounding `1.7` down would be a quiet second opinion about a
  choice.
- **The one-click start survives.** `openChatWith` is the card's own gesture: a card with zero or
  one greeting starts immediately, and only a card that actually offers a choice opens the
  existing `new-chat` dialog, which now lists the greetings and applies the chosen one. That
  also reconnects the dialog's create branch, which had been reachable only from inside a chat —
  where it always took the "you already have one" path.
- **`characters.update` merges `meta` instead of replacing it**, and the editor sends one
  greeting key per save. A whole-blob patch is what lets two saves issued moments apart drop
  whichever key the slower request still held; a one-key patch composed by a merge cannot. Import
  still sets the whole blob at creation, which is the only place a full replacement was ever
  meant.
- `characterToCard` writes `first_mes` from `greetingOf` and `alternate_greetings` from the
  blanks-dropped list, so a card authored here exports like an imported one, and a blank row the
  editor is holding never reaches the file.

## Alternatives considered

**A first-class `characters.greeting` column.** Rejected. Greeting is card data: `cardToCharacter`
already stores it in `meta`, `characterToCard` already folds it back out, and `meta.card` holds
the original JSON. A column would be a second source of truth for `first_mes` on every imported
card, needing a backfill and a reconciliation rule — and it buys nothing, because a greeting is
never rendered into the cast block, so it touches no token count, no block order and no cache
prefix. The `meta` path was already the reader; this change only made it writable.

**Store the alternates as message `variants` so the writer can swipe between openings after the
chat has started.** Deferred, not rejected. `variants` already means "candidate generation",
`messages.create` activates the last one, and a greeting is expanded and written once because the
history block is append-only. Swapping the opening after the fact is a real feature (SillyTavern
has it), but it rewrites the *head* of the history block — the most expensive edit the payload
admits — and it deserves its own decision about how that cost is shown. Editing the opening turn
inline already covers the fix-it case today.

**Whole-`meta` client patches.** Rejected. The editor's fields commit independently on blur; two
whole-blob saves racing would drop whichever key the slower request still held. The merge plus
one-key patches removes the race rather than documenting it.

**A greeting field on the creation assistant's `create_character` / `update_character` tools.**
Deferred. The assistant is a separate write path with its own object limits, and
`update_character` patches `Character` fields directly, so a greeting there needs the same
read-modify-write over `meta` — a change worth making deliberately rather than beside the editor
that a writer can already reach.

**Ship the opening line only, with no alternates.** Considered as the smaller change. Rejected
because the request named the SillyTavern shape, and an imported alternate the app round-trips but
never offers is a half-feature. The picker reuses a dialog that already existed, so the marginal
surface was one radio group.

**A modal for every chat start.** Rejected. The one-click card gesture is a stated principle of
the library ([the cast is a library](2026-09-22-cast-is-a-library.md)); a dialog in front of the
common case — one greeting, or none — is friction for a choice that does not exist.

## Consequences

- **A greeting edit is free in cache terms and useless to a running chat**, and both are said in
  the editor rather than discovered. It is the one authored line that becomes transcript instead
  of cast block, so it cannot re-price anything that already exists — and a chat that has already
  started keeps the line it opened on.
- **One chat per character means the greeting list is consulted once per card.** After that, the
  opening line is edited in the transcript like any other turn; the card's greetings only matter
  for a chat that does not exist yet.
- **`meta` merge is now part of `characters.update`'s contract**: a patch changes keys and cannot
  remove one. Nothing in the app deletes a `meta` key, and import writes the whole blob, so the
  contract is safe — but a future writer that wants to clear a key must send an empty value, not
  omit it.
- **Two views of the same slots, deliberately.** `greetingSlotsOf` keeps a blank row so the
  editor does not delete a field the writer is mid-way through; `greetingsOf` drops blanks so the
  picker and the seed cannot offer nothing. An empty alternate is stored, never offered, and
  never exported.
- **A card with no greeting opens a blank chat**, which is a legitimate state and the recovery
  path for every character authored before this change.

## Verification

- `npm run verify:store` — **162/162**, including four new cases pinned by name: `startChat`
  seeds the chosen alternate (`greeting: 1` writes the second line, not the first); a `meta`
  patch merges (`first_mes` changes while `tags` and `alternate_greetings` survive); an
  unresolvable index falls back to the opening line; and a blank slot is not offered (a
  whitespace opening plus an empty alternate collapse to index 0 being the one real line).
- `npm run verify:tx` — unchanged and passing; nothing here is a multi-row write.
- `npm run verify:cache` — **85.9% overall (5632 hit / 928 miss)**, worst prediction drift 10.6pt
  after the cold turn. The first turn's payload is byte-for-byte the one the cast note recorded
  (1861 tok, 9 blocks, `cast:120`), which is the point: the composer is untouched, a greeting
  lives in the transcript that was already one block, and this change adds no block and reorders
  none. The drift matches the 64-token cache granularity observation already open in
  [the cast is a library](2026-09-22-cast-is-a-library.md), not a new regression.
- **Browser**, against a throwaway database on its own port. In the card editor, the Opening
  section rendered the opening line and one alternate with a remove control; editing the opening
  and saving persisted it (`GET /api/characters` showed `first_mes` changed while
  `alternate_greetings` survived); adding a second alternate persisted it (the array grew to two
  entries). From the Discover roster, `New chat with Vess` opened the dialog and listed
  `Opening line` and `Alternate 1` with their real text; the greeting radio and the prompt radio
  were independent groups (one selection each, read from the DOM); choosing `Alternate 1` and
  pressing `Start chat` opened the chat on “The door is already open. You do not knock.”,
  labelled `opening`, with the composer ready to continue. Zero console errors and zero failed
  requests on a fresh load.
- **Overflow**: `document.documentElement.scrollWidth === clientWidth` at the 1280px viewport,
  and with the dialog's content pinched to 320px every greeting label row measured 288/288 with
  zero overflowing descendants. The shared browser exposes no viewport resize, so the 320px
  measurement is a forced-width proxy for the phone layout, not a real 390px viewport.
- `npx tsc --noEmit`, `npm run verify:notes` and `npx vite build` are clean; `POST
  /api/characters/:id/chat` returns `400` for `{"greeting":1.5}` and `200` otherwise.
