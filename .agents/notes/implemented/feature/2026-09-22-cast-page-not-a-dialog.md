# Agent Note: The cast is a page, not a dialog

Status: implemented

## Problem

Building a character or a persona was reachable only through the payload inspector. The cast
lists existed in exactly one place — the Cast and Persona sections of the rail's drill-down —
so adding someone to a story began with a detour through *what the next request contains*.

That inverts the product's own hierarchy. The cast is story content: it is what the writer
came to build, and the request that carries it is instrumentation about that content. The
[instrumentation note](2026-09-22-progressive-disclosure-of-instrumentation.md) established
that instrumentation is disclosed on intent and never on stage; routing the content *through*
the instrumentation is the same mistake from the other direction.

A first attempt at this shipped a `Cast` **dialog** (a `Shell` over the prose, 54rem wide,
rendering the inspector's two lists). It answered the "no way in from the left rail" complaint
and got the round trip wrong in three separate ways at once:

- **A roster cannot be scanned through a 54rem keyhole.** Choosing a card is comparative — you
  look down the list, note token counts, and come back to it after opening one. Sixteen rem of
  window over prose that the writer is not reading is the wrong shape for browsing.
- **Its own contents had to be reached twice.** A card opened from the dialog closed the
  dialog; a delete prompt opened from it closed the dialog; so closing *anything* had to know
  where it came from. That produced a `from: 'cast'` field threaded through the `Dialog` union,
  the card editor, both editor bodies and the confirm prompt — four files of bookkeeping to
  re-create a surface that was never actually gone.
- **The phone still had two names for the same people.** `Characters` and `Your personas` sat
  under *This story* while the cast page held both again below — the sheet had no other route
  to either.

## Decision

**The cast is a page that replaces the centre column, opened from the studio list in the
library rail.**

- **`page: 'story' | 'cast'` in the store** (`store/types.ts`), rendered by `App`: the centre
  column is `CastPage` or the transcript — the header, transcript and composer— and never both.
  The composer is absent on the page because a page is not a place to write, and the page is
  absent over the composer because building a cast is not writing.
- **Surfaces, not overlays: the page never covers the library rail on a wide screen**, which
  keeps its story list, scenes and studio rows while the roster is up — and `CastPage` draws its
  own band with a back control as the single way out. A page replaces a *column*, not the window.
- **`CastPage` is a roster**: one card per entry, searchable by name *and by the line under it*
  ("the steward" is as often looked up by what the card says), filterable by kind, sortable by
  recency, name or weight. Characters and personas share the grid because "who is in this story,
  and who am I" is one question even though it is two tables; grouping by kind returns only when
  no filter has been asked for, since a filter is a request for one list.
- **Every card prints its token count**, from the server's own accounting. These cards sit in the
  frozen prefix: a 400-token card is 400 tokens on every request for the life of the story, and
  that is the one figure here a writer acts on.
- **No tags, no favourites, no creator fields.** Imported cards carry tags inside
  `Character.meta`, but `meta` is a freeform blob with no schema any UI writes — a tag filter
  over it would be a filter over nothing. The one grouping that exists is the two kinds that
  exist as columns.
- **`createCard(kind)` is a store action**, not a host's inline code. The add-then-open-its-editor
  flow had been written twice, once per tab, and the page would have made it three; the two tabs
  are now three lines each and the new card's editor opens the same way from anywhere.
- **A page deletes the `from` plumbing entirely.** The field is gone from the `Dialog` union, the
  card editor, both editor bodies and the confirm prompt, because the page is still underneath —
  which is the actual argument for a surface over an overlay: an overlay is not there while it is
  covered, so every layer above it has to remember it.
- **Leaving the page is explicit.** Switching scene, re-picking the story already open, or
  picking a payload section clears `page`, so a drawer or a rail section cannot be opened over a
  roster that is describing a story no longer on screen. Opening a *different* story from the
  library does not clear it: the page is a property of the centre column, so the roster follows
  the story it is a roster of. (Measured, not assumed — an earlier version of this note claimed
  every story open clears the page.)
- **The rail keeps its Cast and Persona sections**, because they answer a different question:
  what the cast costs, in payload order, beside the blocks it sits among. The Cast section gains
  one row, `Open the cast page`.
- **A character card's primary action is now its chat**, and the pencil in the card's footer is
  the editor. That reverses this note's original click target without disturbing its decision
  (page, not dialog): talking to the person is what a card is *for*. See [a character chat is a
  story](2026-09-22-character-chats-are-stories.md) for what a chat is and why the card is not
  copied into it. A persona card is unchanged — a persona is the writer's own mask, and its whole
  card still opens the editor.

The rule this generalises: **a list of payload sections is not a table of contents for the
story.** Content gets a surface of its own, sized for browsing it; sections describe what the
next request carries. And a surface that must survive being covered should be a page.

## Verification

In the running application through the browser:

- **The row exists where the problem was.** The library rail's studio list reads `Cast`,
  `Cost & cache`, `Story settings`, `Prompt templates`, `Import & export`, `Duplicate story`.
- **The page replaces the centre column**: on `Cast` the document has no composer and no app
  header, the page's own band reads `Cast · 5 cards · 175 tokens in the prefix`, and the library
  rail is still present beside it with its story list, scenes and studio rows.
- **The roster renders real cards**: one per entry, each with its kind chip
  (`character` / `persona`), the `active` badge on the story's persona, its tagline or
  description line, and its token count.
- **Search narrows it**: `steward` leaves exactly `The Steward`.
- **Filters narrow it and drop the headings**: `Personas` leaves exactly the one persona with no
  group headings; `Characters` leaves exactly the four characters.
- **Sort reorders**: by weight gives 76, 62, 3, 3 · 31 and by name gives Cantarella, New
  character, New character, The Steward · Aleron — within each group, as documented above.
- **Round trip needs no `from`**: opening Cantarella Fisalia's card from the roster and closing
  it returns to a `Cast` band with the roster and no dialog. (The editor is now reached from the
  card's pencil rather than its face — see below.)
- **Add and delete work from the page**: `Character` created a card, opened its editor, and
  deleting it from that editor left the roster at 5 and the database
  (`GET /api/stories/:id/characters`) at its pre-existing rows.
- **The rail's section still works and still leads to the page**: the inspector's `Cast` section
  renders its list and totals as before, ending in `Open the cast page`, which opens the page.
- **The palette reaches it**: `Ctrl+K` → `Cast`, opening the page with the palette closed.
- **The transcript is not unmounted into a broken stream.** With a turn *confirmed mid-flight*
  (`writing…` true and a Stop control present), opening the cast page and returning 1.2s later
  showed the turn still streaming — the stream is owned by the store's `activeController`, not
  by the transcript component, so covering it aborts nothing.
- **The grid adapts and never overflows**: 4 columns at 1920, 3 at 1568/1440/900/768, 2 at
  1280/1024, 1 at 430/390/360/320 — `scrollWidth === clientWidth` at all eleven widths, and
  individual cards report zero inner overflow too.
- **The phone sheet lost its duplicates and kept the destination**: at 390px the sheet reads
  `World & lore, Memory, Scene, Director & notes` under *This story* with no `Characters` or
  `Your personas` row, and `Cast` under *Studio* opens the page, its band's back control
  returning to the transcript.
- **The page is not a trap below `lg`.** The header is not rendered over a page, so on a phone
  and at 1024px the band's back control is the single way out — verified reachable in both, and
  that the composer returns with it.
- Zero console entries and zero errors after a reload. `npx tsc --noEmit` exits 0; `npx vite
  build` succeeds; `npm run verify:notes` conforms.

## Alternatives considered

**A `Cast` dialog over the prose** (its own `Shell`, the inspector's two lists inside). This was
built and discarded in the same session, so the reasoning is measured rather than projected: it
put a roster in a 54rem frame, it could not show a grid of cards without a scroll, and it
required `from: 'cast'` on the dialog, the card and the confirm prompt just to return to itself.
The reintroduction condition is worth stating plainly — *a future reader may well re-propose a
modal here because the rest of the product's deliberate surfaces are dialogs.* The distinguishing
question is not "is this deliberate?" but "does the writer browse it?". The ledger, the card
editor and import/export are dialogs because they are read once and closed; a roster is scanned,
compared, and returned to.

**A `Cast` row that opens the inspector's Cast section** (`setRightTab('cast')` +
`setRailOpen(true)`). Rejected as the smaller, wrong answer: it still requires reasoning about
the payload to edit content, and on a phone it opens a drawer over the story rather than a page.

**Move Cast and Persona out of the inspector entirely.** Rejected: those sections are where the
cast is legible as part of the request — count and tokens beside the other blocks, in payload
order. The [drill-down note](2026-09-22-payload-rail-as-drilldown.md) makes that ordering
load-bearing ("reading the menu top to bottom is reading the request top to bottom"), and
removing two rows from the middle of it breaks the ordering the rail is built on.

**A tag system, so the roster could be filtered by `#fantasy` and `#dark`.** Rejected for a
factual reason rather than a taste one: the tags a SillyTavern card carries live in
`Character.meta`, which Reepi treats as an opaque round-trip blob (`cards.ts`: "Reepi's
`Character` has no column for tags … so those live in `meta` and are folded back out on
export"). Filtering on them would mean a client reading an unschema'd JSON blob, and the
filter would silently do nothing for every card a writer authored in Reepi. A real tag store is
a schema decision, not a UI one, and is not smuggled in here.

**A cross-story character library**, the way the reference surface browses other people's
characters. Out of scope, and a different product: every card in Reepi is a row owned by one
story, priced into that story's prefix, and import/export is already the route between stories.

## Consequences

- **One more piece of store state, and one more branch in `App`.** `page` is a two-member union
  with no persistence: a reload always returns to the transcript, because the story is what a
  writer came back for.
- **Opening a payload section leaves the page.** A writer on the roster who opens the Cast
  section loses the roster. Deliberate — the drawer would otherwise cover the roster with a panel
  about a story that is not visible behind it — but it is a rule a reader has to know, so it is
  commented at both call sites.
- **The roster is per story**, so there is no "browse other people's characters" surface and no
  discovery. That is the reframing of the reference design rather than a missing feature: Reepi's
  unit of work is the story, and a cast outside a story has no token cost and no cache argument,
  which is the only thing that makes a card interesting here.
- **The four-figure grid is not virtualised.** A cast of a few dozen cards renders fine; a cast of
  thousands would not. Accepted knowingly — `CastPage` costs one DOM node per card, and the
  search field is the answer long before virtualisation is.
- **`createCard` moved into the `library` slice**, so the rail's tabs no longer own their own
  create flow. That removes the duplicated error copy ("Could not add a character" / "a persona"),
  which now lives once, in the action.
