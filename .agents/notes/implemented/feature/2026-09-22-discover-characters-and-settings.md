# Agent Note: Discover, Characters, Settings — and a Prompt the chat can name

Status: implemented

## Problem

The studio had the right parts and the wrong door. Three frictions, reported from a real session,
all of them about the distance between wanting a thing and getting it:

1. **Talking to someone you had written took four gestures.** `Studio` → `Cast` → scope toggle to
   `Library` → the card's `Chat`. The product's engaging act is talking to a character, and that
   path began with a roster you had to switch into, then a card whose *body* opened an editor.
2. **Nothing in a chat could say which system prompt it was using.** Applying a template copied
   text into `Story` columns through the ordinary PATCH, and nothing recorded it — deliberately, so
   the story keeps the words rather than pointing at a row. But the consequence was that a writer
   who applied "House voice" could not see that they had, could not see that a later hand-edit had
   half-broken it, and could not apply another without leaving the conversation and finding the
   library in a studio dialog. The loader asked, in as many words: *how do I even activate or select
   one for a chat?*
3. **The rail was a concatenation.** One scroller carried the assistant row, the new-story form, a
   search field, day-filed conversations, seven studio destinations, the scenes of the open story
   and four theme swatches. A writer scanning it for "where do I change the model" learned nothing
   from the order, and the four destinations they touch twice a year sat at the same level as the
   list they live in.

The design system was not the problem — the hierarchy was. So the fix is re-filing, not restyling:
no new visual language, no new HTTP route, no schema change.

## Decision

**A launcher, a library page, a settings directory, and a chat-scoped Prompt section.**

### Discover is the front page

`page: 'discover'` is a new centre-column page, and it is where a session with nothing open lands.
`boot` no longer opens `stories[0]`: it opens the conversation remembered in `reepi.lastStory`
(a story id in `localStorage`, beside `reepi.rail` and following the same try/catch-private-mode
shape), falls back to the newest story, and falls back again to `discover`. A remembered id that no
longer resolves is treated as absent — a story deleted in another tab must not land the writer
nowhere.

The launcher is: `Create` / `Import` in the band, one search over conversations *and* characters,
the six most recently updated conversations, and the character roster with a `New chat` or `Resume`
on every card.

Three things it deliberately does **not** show, each by a rule that already existed:

- **No cost, hit rate or token count on a conversation row.** `progressive-disclosure-of-instrumentation`
  says a number is visible by default only if the writer must act on it to keep writing. A row's job
  is to be opened; its price is one deliberate action away in the rail.
- **No invented `POPULAR` hashtag list.** The filter row is derived from `Character.meta.tags` — where
  the card importer has always parked them — read strictly (`Array.isArray`, `typeof === 'string'`,
  dedupe, cap), ordered by frequency with alphabetical tie-breaks, and **hidden entirely** below two
  distinct tags. A filter over nothing is decoration.
- **No second list of stories.** The rail beside the launcher is already the full, day-filed library.

`openStory` now sets `page: 'story'` on **both** paths. This was a latent bug: the early return
("re-picking the story you are already in") reset the page, and the fresh-load path did not — so
opening a story from the cast page left the cast page mounted over it. Every host that can open a
story now lands on the transcript, and `rememberStory` is written from `openStory` rather than from
`boot`.

### Characters is the app-wide library; Cast stays the payload roster

Two pages, two questions, each stating its own scope in its band:

- `cast` (existing): what *this story* sends, totalled in tokens.
- `characters` (new): every character grouped by home story, and every persona grouped by the pool it
  belongs to — `All · Characters · Personas`, one search.

Personas are app-wide on this page and still story-scoped in the schema. That is stated rather than
papered over: the page names the story each pool belongs to, `New persona` writes into the open
story's pool when one is open (and says so in the button's `title`), and with no story open it routes
to the creation assistant with `setCreatorTarget(null)` — the app's one way to author structure with
no world, and the honest alternative to a disabled button.

**`RosterCard` is extracted.** Discover, Characters and CastPage now render one card, in the shape
that was `CastPage`'s private markup, including the rule that made it two shapes: a card whose body
opens a conversation cannot be a single button, because the pencil and the cast control would be
buttons inside a button. Three copies is exactly the drift `StudioNav` was made one list to prevent.

### Settings is a directory over the dialogs that already exist

`page: 'settings'` groups rows by subject — This story (prompt settings, duplicate, delete), Content
(characters, assistant), Studio (theme swatches, prompt templates, import & export), Cost & cache
(ledger, diagnose, warm, balance). Every row either opens a dialog that already existed or navigates
to a page that already existed. **No dialog is re-implemented and no new dialog is created**; the
value is the filing.

`StudioNav` shrinks from seven rows to three (Characters, Creation assistant, Settings), and keeps
serving both hosts, so a destination cannot exist in the rail and be missing from the phone's sheet.
Discover is *not* in that list, because it is rendered as its own primary control above the library
in both hosts — repeating it would be the double-listing the hierarchy exists to remove.

One rule keeps the page honest: **a row whose subject does not exist is omitted, never disabled.**
No story open means no `This story` section at all, not five greyed controls. "No story is open" is
said once, in the band.

### The Prompt section is the answer to "which prompt is this chat using?"

A new `RightTab`, `templates`, filed in the rail's menu immediately after `Payload` — the one entry
that is not a `BLOCK_ORDER` kind, because a prompt is not a slice of the payload, it is the text that
lands in several of them. `Inspector` renders it like any other section, so the band, the back control
and the summary come for free.

What the section does:

- Lists every template with its blurb, its `builtin` chip, and the blocks it fills — each block chip
  carrying its volatility colour, the same table the story editor warns with, so the two surfaces
  cannot disagree about what an edit costs.
- **Applies through `applyTemplate`**, the existing action: one batched `updateStory` PATCH for the
  template's blocks, then a toast earned by reading the story back. No new action, no new route, no
  second write path.
- **Confirms in place**, naming every block it will overwrite and calling out any frozen (volatility
  0) one as the whole-prefix invalidation it is. Same wording the template dialog already uses.
- **Reports the last applied template for the session, and computes the match from the story.**
  `applyTemplate` records `ui.appliedTemplate = { templateId, name, at }` *after* the read-back, so the
  row can never name a prompt whose text is not in the story. The count is derived by comparing the
  template's block text against the story's own fields, so a hand-edit afterwards makes the row say
  `applied · 2/3 match` instead of insisting on a template that is no longer true.

**It is not persisted, and the UI says so** — `applied this session`. A reload shows `N templates`
with no claim about ownership.

### One new dialog, for the ordering problem the old flow had

`dialogs/new-chat.tsx` picks a prompt *before* the conversation exists, which is the one thing the
old flow could not do: a writer who had just written a prompt for a card had to start the chat and
then go find the library. It is reachable from the rail's chat header (`Prompt for this chat`).

Two decisions inside it:

- **It refuses to run when a chat already exists.** `stories_character_id` is unique, so
  `startChatWith` would open the existing conversation, and a "new chat" picker over an existing chat
  would be a lie about what the button does. The dialog says so and offers to open it.
- **The prompt is applied after the chat exists, through the ordinary PATCH.** There is no composite
  endpoint and nothing to make atomic. The consequence is stated where it can happen: if the chat is
  created and the template write then fails, **the chat stays**, because rolling it back would delete
  the card's greeting over a prompt that is one action away in the rail. The error is the existing
  toast.

The rail's chat front page also gained the card itself (avatar, name, tagline) with `Edit card`,
`Characters`, and `Prompt for this chat`, which is where the screenshot's chat-scoped right panel
became a fact in this codebase rather than a layout to copy.

## Alternatives considered

**Persist an active template on the story (`stories.template_id`, nullable FK, `ON DELETE SET NULL`).**
Rejected for now, though it was the option that would let a chat *own* a prompt and re-apply after an
edit. It costs a column, a migration, a hygiene test, a decorator on every story read, and a
`templateId` write path — and it buys a fact that is already legible from the blocks, because applying
is copying text and the text is right there. It also invites the failure this design is built to
avoid: a stored reference that disagrees with the words. It is the one-edit path if re-application
becomes a repeated need, and it is recorded here so that is a decision rather than a re-derivation.

**Keeping the flat seven-row `StudioNav` and trusting the palette.** Rejected: seven rows in a
directory list is a list nobody reads, and the palette is a way to *reach* things, not a way to learn
what exists. The `Cost & cache` row had already been rewritten once because it behaved as a second
launcher for navigation; the same argument now applies to the whole list.

**Copying the reference app's information architecture exactly (Discover / Personas / Image Studio as
three sidebar sections).** Rejected as a copy rather than a design. `Personas` became a scope on a
Characters page because a character and a persona differ in a way the schema already encodes, and
`Image Studio` has no counterpart here — no UI writes `Story.cover` yet. What was taken is the shape:
a Frontpage launcher, a roster with the card's own tags, and chat-scoped actions on the right.

**A `kind` column, or many chats per character, to make Discover a chat list.** Still deferred, and
still for the reasons in `character-chats-are-stories`. Discover lists one conversation per card
because the schema makes a second impossible.

**Making Discover the page you can never leave (a modal, a drawer, a tab bar).** Rejected: the
transcript is the product, and the launcher is a place you pass through. It is a page with a back
control and a header home button, nothing more.

**Deleting `CastPage` and folding everything into `Characters`.** Rejected: "what does *this story*
send, and what does it cost" is a real question about the frozen prefix, and the payload roster is
the answer to it. Two pages with two bands that state their scope beat one page with a scope toggle
whose current position a writer has to notice.

## Consequences

- **The launcher costs one gesture on cold load, and buys the roster.** A writer whose last
  conversation is remembered still lands in it, so the cost falls only on a genuinely new session —
  where the thing they need is exactly the roster.
- **`Cast` and `Characters` both exist and can be confused.** Mitigated by each band stating its own
  scope, and by `RosterCard` making the two pages look like one design rather than two.
- **The prompt report is session-local.** After a reload a chat cannot say which template was applied,
  only that templates exist. That is the honest cost of copy-not-reference, and it is the price of the
  rejected column above.
- **`applyTemplate` now has a UI side effect** (`setAppliedTemplate`) beyond the story write. It is
  write-order dependent — recorded only after the read-back — which is what makes the rail's count
  trustworthy; a future caller that applies a template without wanting the rail to report it would
  need to clear it.
- **A remember-the-last-conversation key is a small new persistence surface.** It is best-effort,
  never throws, and falls back through newest-story to launcher, so a missing or stale value degrades
  to the old behaviour.
- **The phone's sheet lost its theme swatches** and its duplicated studio rows. Theme is a row of
  swatches in Settings; the four destinations are rows at the top of the sheet. The rail keeps its
  own `Studio settings` door rather than its own swatch row, so there is one place a theme is chosen.

## Testing

- `npm run typecheck` — clean.
- `npm run verify:store` — **131/131**. `npm run verify:tx` — rollback and commit both proven.
  `npm run verify:notes` — 23 notes, all conform. Nothing under `server/` was touched, so these are
  regression checks for a navigation change, not new coverage.
- `npm run verify:cache` — not run: no file it exercises (composer, orchestrator, macros, blocks)
  was modified. The Prompt section writes only `Story` columns that already existed, through the same
  PATCH `updateStory` always used.
- **Nine widths, measured in a real Chromium, three surfaces per width** (`320, 360, 390, 430, 768,
  1024, 1280, 1440, 1920`): `documentElement.scrollWidth === clientWidth` on Discover, Characters and
  Settings at every one of them, plus the transcript and its rail's Prompt section at 1280/1440/1920 —
  `ok` with no clipped inner element on all 32 rows. Three portraits resolve as `<img>` on Discover
  (Augusta, The Steward, Cantarella) with zero broken images.
- **Apply round-trip, on a throwaway story.** Applying *The narrator contract* from the rail:
  the confirm names the frozen block ("Voice & format contract is frozen: this invalidates the whole
  cached prefix"), and after the read-back the Prompt row and its band summary read
  **`"The narrator contract" · all 1 block match`** with the `applied` chip. The Payload section then
  reports `changed` on *Voice & format contract*, `vol 0`, after the write — so the text really moved,
  and the prompt report was earned by reading the story back rather than by having called the action.
  The throwaway story was deleted afterwards (`DELETE /api/stories/:id`, 200).
- **Boot chain, verified live.** A cold load with `reepi.lastStory` set lands in that transcript; a
  reload lands in the same conversation; a cold load with the key removed falls back to the newest
  story and re-remembers it; and the header's home control returns to Discover. The launcher is the
  landing page when there is nothing to open.
- **One pre-existing console error, not from this change:** a card in the dev database stores a bare
  base64 portrait without its `data:` prefix, so the browser requests it as a relative URL and gets a
  431. `/api/characters` shows the same row, and no file in this change touches avatar handling.
- Screenshot pass over Discover, Characters, Settings, the rail's Prompt section and the in-place
  apply confirm at 1280; the phone widths were measured rather than photographed.
