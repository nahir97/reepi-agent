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

### The story panel is the chat's control panel, not an index of sections

The section menu's first shape was one row per payload section, each with a live
summary. That was a real improvement on the seven-tab strip it replaced, and it was
still an *index*: eight pointers next to a lot of empty panel. Two things exposed it.

**The phone's panel icon opened the Cast section, not the menu.** `AppHeader`
hard-coded `setRightTab('cast')` before opening the drawer, so the first thing a
writer saw after tapping the panel was a one-card roster — or an empty one — and a
back chevron they had no reason to press. The icon now opens the drawer at its
front page, and a section is one tap further in. (The screenshot that reported this
was of a phone *served by `:8787`*, whose `dist/` predated the navigation change;
on the dev server the sheet had the four destinations. Both were verified.)

**The front page was thin even once reached.** So the menu is now the panel:

1. **Identity** — a chat leads with its borrowed card (portrait, tagline, token
   weight, `Edit card`, `Prompt`); a plain story leads with its own shape (scene,
   model, effort, cast/lore/memory counts, `Story settings`, `Prompts`).
2. **Context** — Cast, Persona, Lorebook, Memory, Scene, Director, each carrying up
   to three of its *actual* items: the lore entries with whether they are firing or
   armed on keys, the memories with their subject, the scene's state fields with
   their values, the cast with their token weights, the pending Director notes. When
   a section is empty it says what to do about it rather than printing a zero.
3. **This conversation** — `Search messages`, `Rename`, `Duplicate`, `Delete`,
   `Import & export`. Every row calls an action the app already had; a panel that
   only reads is a panel you have to leave to act.

There is deliberately **no payload group and no cost row**. A first version of this
page had both, plus `Re-measure` and `Warm the cache`, and it was accurate and
cluttered: a rail that reports on the request is a rail competing with the prose for
the same pixels, which is the failure `progressive-disclosure-of-instrumentation`
was written to end. The next section is where that tooling went.

The previews are the substance the reference comparison asked for — world lore
lives in the panel, visibly, without a click — and they cost one `useSectionItems`
hook rather than seven bespoke widgets, because each one reads the same bundle the
section it previews reads.

**Rename uses `window.prompt` for now**, and that is a known compromise rather than
a decision: the app's own rule is that confirmations happen in place, and a native
prompt is the one dialog here that does not follow it. It is recorded under
Consequences.

### Where the payload and prompt tooling went when it left the panel

The rail's `Prompt` section — the row that answered "which prompt is this chat using?" — is gone with
the rest of the payload group, and nothing it did was lost:

- **Seeing what a template would write** is the prompt-templates dialog's own list (name, blurb, blocks
  it fills), which is where a writer goes to author one, and the per-block `Templates` menu in Story
  settings, which is where they apply one to a single field.
- **Applying one** is unchanged: `applyTemplate` through the one story PATCH, with the frozen-block
  warning in place.
- **The block-by-block report** is `dialogs/payload.tsx`, opened by the composer's cache pill and by a
  `Payload report` row in Settings.
- **`Warm the cache`** is in the composer's overrides popover and in Settings.

The `appliedTemplate` session record stayed, and so did `setAppliedTemplate`. The only thing that read
it was the rail's Prompt row, so it is now read by nothing — recorded under Consequences rather than
deleted, because the next surface that wants to say "this chat speaks in House voice" is the reason it
exists and it is three lines to wire.

### `Search messages` filters the transcript in place

The one reference row with no counterpart in this app. Built client-side — no route,
no index, no migration — because a conversation is already loaded in memory and
`Message.variants` is what a writer means by "a message":

- The panel's row flips `messageSearchOpen` (`chrome` state, like `rightTab`, because
  the control is in one column and the field in another).
- `Transcript` renders the field above the scroller, focuses it once on open, and
  filters turns on `speaker + every variant` — every candidate generation, so a line
  someone regenerated is still findable. Reasoning traces are excluded: that is the
  model's working, not the story.
- The field reports `N of M`, the empty state says so explicitly rather than showing
  a blank page, and `openStory` clears both the filter and the field, so a search for
  someone else's words can never outlive the story it was typed in.

`InspectMenu` owns identity, the Context group and the verbs. `SECTIONS` shrank to
the six material sections and `RightTab` with it — `blocks` and `templates` are no
longer section ids at all, so the rail cannot grow a request-shaped row back by
accident, and the command palette lost its `Inspector · …` entries with them.

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

**Keeping the payload group in the story panel.** Rejected after living with it for one round of
feedback, and it is the more interesting rejection because the first version of it was *correct*.
`Payload`, `Prompt`, `Cost & cache`, `Re-measure` and `Warm the cache` all reported truthfully on the
next request — and that was the problem: the rail is a panel a writer keeps open while reading, so a
report on the request sat beside the prose, competing for the same pixels, which is the exact failure
`progressive-disclosure-of-instrumentation` was written to end. They also asked a question — "what does
the next turn cost" — that the writer has while *writing*. So the tooling moved to the control that
measures it: the composer's cache pill now opens the block-by-block report as a dialog, and the prompt
library stayed in Settings and Story settings. Re-measure and Warm live in the composer's overrides
popover and in Settings, because they are acts on the request rather than facts about the story.

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
- **`Rename this conversation` and `Search messages` open native `window.prompt`s**, which is the one
  place the interface leaves its own confirmation convention. Both are genuinely one-value prompts
  (`updateStory({title})`, a needle), both are reached deliberately from the panel, and building two
  inline editors for them would have been more surface for less. A future pass that gives the panel an
  inline rename field deletes two lines here and nothing else.
- **The panel's previews read the whole bundle**, so they show the first three rows of each section
  rather than "the three that matter". Ranking them would be inventing a second opinion about the
  writer's material; the cap is a preview, and the section is the list.
- **Message search is a filter, not a jump-to-result list.** With ten turns it is obviously right;
  with a thousand it would want a match list with positions. `Message.seq` and the scene filter are
  already there to build one, and the field is the seam it would attach to.
- **`ui.appliedTemplate` now has no reader.** The rail's Prompt row was the only surface that displayed
  it, so the record is written and never shown. Kept rather than deleted because "this chat speaks in
  House voice" is a fact worth having a home for, and the wiring is three lines; if it is still unread
  at the next pass over this panel it should go.
- **The payload report moved from the rail to a dialog**, which trades one kind of friction for
  another. It is no longer visible while reading — deliberate — but it is also no longer reachable
  without the composer on screen, which is why Settings carries a `Payload report` row too.
- **`RightTab` is now story material only.** That is the structural half of this change: the rail
  cannot regrow a request-shaped row without editing the type, which is the kind of guard that keeps a
  rejected shape rejected.

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
- **The panel's previews, read off the running app at 420px with the drawer open** on the story that
  has real content: `Cast 4 characters` listing them with token weights, `Persona 2 personas` with
  `active — read as you`, `Lorebook 0 entries` (the data really is empty), `Memory 6 facts · 3
  recalled now` with the recalled sentences, `Scene 5 state fields · 2 open threads` with *Time
  midnight / Location dark stone corridor*, and `Director 2 notes waiting` with the critique text —
  so a section with content shows it and a section without says so.
- **Message search end to end** on a story with ten turns: the field appears focused, `plaster`
  narrows `turns before=10 after=3 counter=3 of 10`, a no-match needle renders the explicit empty
  state with zero cards, clearing restores 10, and Escape closes the field. Zero page errors.
- **The slim panel, read off the DOM at 320/390/768/1280**: the drawer's front page contains
  `CONTEXT` and `THIS CONVERSATION` and no `PAYLOAD` group, no `Cost & cache` row, no
  `Re-measure` and no `Warm the cache`; `documentElement.scrollWidth === clientWidth` at all four,
  and the payload dialog opens from the composer's cache pill at all four (its title reads
  *The next turn's payload*) with zero page errors.
