# Agent Note: The payload rail became a drill-down, and the ledger left it

Status: implemented

## Problem

The payload rail was a seven-tab strip across a 21rem column, and it showed every
section only after a click it gave no reason to make. From the screenshots that prompted
this:

- **Seven tabs in the narrowest column in the app.** `Blocks Cast Persona Lore Memory
  Scene Director Cost` ran the full width of the rail at the smallest legible size, and
  the labels were abbreviations of the section names — `Scene` for *what the narrator
  tracks*, `Director` for *passes, notes and synopsis*. A reader had to click to find out
  whether the lorebook had fired, then click back to check the notes.
- **The Director section was a wall.** Four pass buttons, each with a full-sentence
  blurb, then the explanation of what a pass *is* — all of it above the notes, which are
  the only thing there a writer returns to. A 20rem-tall preamble before the content on
  every visit.
- **Cost was a tab among eight, in a 21rem column.** The ledger is the widest content in
  the product — four headline figures, six secondary ones, a peak clock, a projection
  with a two-tone bar, a sparkline and a per-kind breakdown. It was rendering in a
  column narrower than a phone, and it was the one section that is about money rather
  than about the next request.
- **`Inspector · <tab>` in the command palette was inert on a desktop.** It called
  `setDrawer('right')`, and the right drawer is `xl:hidden` — so at every width where the
  rail exists, that command set state nothing rendered.

## Decision

**The rail is a drill-down over a menu of sections, each row carrying its own live
summary, and the cost ledger is a dialog rather than a section.**

- **`InspectMenu` is the rail's front page**: one row per section with an icon, the
  section's name, and a **live summary** — `Payload · 2.74k tok · 69% predicted hit`,
  `Lorebook · 0 entries`, `Memory · 6 facts · 3 recalled now`, `Director · 2 notes
  waiting`. The summary is the whole reason a level of navigation earns its place; without
  it this would be a worse tab strip. Ordering is payload order, unchanged.
- **`useSectionSummary` is the single source of those strings**, and the band above an
  open section shows the *same* string the row did. Two copies of that arithmetic is how
  a heading starts contradicting the row that was clicked to reach it.
- **One band, both states.** The rail's band is `Inspect · <story>` on the menu and
  `<Section> · <summary>` with a back control once a section is open — it *replaces* its
  own contents rather than stacking a second bar. `Inspector` owns it, and takes an
  `onClose` so the rail and the drawer each get their own close.
- **The Director's passes fold.** Four buttons and their explanation behind one
  `<details>`, because the notes are the section's content and the passes are reached
  occasionally. This is the disclosure rule the
  [instrumentation note](2026-09-22-progressive-disclosure-of-instrumentation.md) already
  states, applied to a section's own chrome rather than to a turn.
- **Cost & cache is a dialog**, listed as the last row of the menu and marked *opens as a
  dialog*, because it needs the whole window to be readable and it answers a question
  about money rather than about the next request. It was already reachable as a dialog
  from the palette and from `StudioNav`; the tab was a third, worse route to the same
  place.
- **The rail's open state moved into the store** (`railOpen` + `setRailOpen`, persisted
  under `reepi.rail`, replacing `App`'s local `useState`). The palette's section commands
  now set it, so `Inspector · Cast` reveals the rail instead of writing to a drawer that
  cannot render.
- **`RightTab` gained a `null` member** via `RailView = RightTab | null`, and the initial
  `rightTab` is `null` — the rail rests on the menu, so opening it answers *what is in
  here* before it asks *which one*.
- **The palette's section list is derived from `SECTIONS`**, so a section's hint cannot
  exist in the menu and be missing from the palette. The palette now prints
  `Inspector · Cast` rather than `Inspector · cast`.

The rule this generalises: **a navigation label must carry information, or the level of
navigation it needs is not worth having.** Seven words in a strip carry none; a row with a
live count carries some; a row with a live count that is also the heading of the page it
opens carries both.

## Verification

- **The menu renders with real summaries** at 1568px: eight rows, reading `Payload · 2.74k
  tok · 69% predicted hit`, `Cast · 2 characters`, `Persona · 1 persona`, `Lorebook · 0
  entries`, `Memory · 6 facts · 3 recalled now`, `Scene · 5 state fields · 2 open threads`,
  `Director · 2 notes waiting`, `Cost & cache · the ledger · opens as a dialog`.
- **The band and the row agree**: clicking the `Cast · 2 characters` row produced a band
  reading exactly `Cast 2 characters`, from the shared hook rather than a second
  calculation.
- **Drill-down round-trips**: opening Director shows one collapsed `<details>` reading
  *Agentic passes · separate contexts, never in the narration payload*, with the two notes
  and the synopsis below it; the back control returns to a band reading
  `Inspect · Cantarella Fisalia` with all eight rows and no back control.
- **Zero tab strips remain** anywhere in the document at every width.
- **The phone drawer carries the same drill-down**: at 390px the drawer is 359px wide,
  shows the band `Cast · 2 characters` with its close control, and does not overflow.
- **The palette command works where it was inert**: with the rail closed, `Inspector ·
  Cast` from the palette opened the rail on the Cast section (`band: "Cast 2 characters"`,
  collapsed button gone, palette closed).
- **The Cost & cache row opens the ledger**: clicking it in the library rail opened a
  dialog labelled `Cost & cache` containing the ledger, not the command palette.
- **No overflow** at 1920/1568/1440/1280/1024/900/768/430/390/360/320 — `scrollWidth ===
  clientWidth` at all eleven.
- **Bands still aligned**: all visible `.topbar` elements report `bottom: 56` at every
  desktop width; transcript and composer columns still share their left edge.
- Zero console errors after a reload. `npx tsc --noEmit` exits 0; `npx vite build`
  succeeds; `npm run verify:notes` conforms.

## Alternatives considered

**Keep the tab strip and just widen the rail.** Rejected: 21rem is already a fifth of a
1440px window given to chrome, and the strip's real problem was not its width but that
seven words with no values cannot tell a writer whether anything is waiting.

**Keep the tabs and add live counts to them** (`Lore 3`, `Director 2`). Rejected as the
worst of both: a count on a tab is unreadable at 11px in a 21rem column, and the tabs
still could not say what the section contains or what it is for. The counts work here
*because* the rows have a second line and a page behind them.

**Accordion instead of drill-down** — sections expanding in place in the rail. Rejected
for the Director and Lorebook specifically, which are the two with real content: an
accordion gives them the same 21rem they were already cramped in, and the Lorebook is a
table with ten columns that needs the full width. A drill-down can decide per section
where it goes; an accordion cannot.

**Move every section into its own dialog.** Considered, because the rail is narrow for the
Lorebook table. Rejected because the rail's value is being *visible while writing* — a
writer watching the payload's predicted hit rate as they type is the one live readout the
product has. The ledger is the exception, not the rule, and it is now the exception.

**Keep cost as a section but render it in a dialog when opened from the rail.** Rejected
as a section that lies about being one: a row that always opens a dialog is a dialog with
a menu entry, which is what it now is, stated plainly.

## Consequences

- **One more click to reach a section's content.** The menu row's summary is what pays for
  it: a writer checking whether the lorebook fired reads `0 entries` on the menu instead
  of navigating to find out. Where the summary is not enough, the click is the same one
  the tab strip always cost.
- **`RailView` is `null`-able**, so every reader of `ui.rightTab` must handle the menu
  state. There were three callers — `Inspector`, the palette and the nav sheet — and the
  palette's `openInspector` is now the one place that has to set both the section and the
  rail's openness.
- **`setRailOpen` lives in the `library` slice** with the other chrome setters, and
  `RAIL_KEY`/`storedRail` live in `store/initial.ts` beside `IDLE_STREAM` rather than in
  `theme.ts`, because only the theme must be read before first paint. The rail opening a
  frame late is invisible; a flash of the wrong theme is not.
- **The ledger's tab is gone but the ledger is unchanged** — every figure, the peak
  clock, the projection bar and the sparkline are the same component in a wider frame.
