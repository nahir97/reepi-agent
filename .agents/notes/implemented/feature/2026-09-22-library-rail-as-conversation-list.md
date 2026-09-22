# Agent Note: The library rail became a conversation list

Status: implemented

## Problem

The desktop rail worked but read as a different application from the transcript beside
it. Four things were wrong, all visible in one screenshot of the shipped build:

- **The chrome bands did not line up.** The rail's header was 57px, the app header 42px,
  and the collapsed payload rail's 32px, so the horizontal rule under them started and
  stopped at three different heights across a window that is supposed to read as one
  surface.
- **The story list was a flat, undated column.** Rows carried a 1.5px colour spine as
  their only identity, so two stories from the same template were distinguished by title
  alone, and there was no answer to "which was I writing last night".
- **A phone had no way to reach the library at all.** The rail is `hidden lg:block` and
  the `drawer === 'left'` sheet that would have carried it was never opened by any
  control — dead code. `App.tsx` rendered it; nothing set that state.
- **Story row actions appeared on hover** — three unlabelled icon buttons in a cluster,
  invisible on touch, and the same trap the [instrumentation
  note](2026-09-22-progressive-disclosure-of-instrumentation.md) already names for
  controls.

Deriving from that, three more defects surfaced while measuring, and they are recorded here
because each was invisible in the screenshot that prompted the work:

- **The composer's column was 48rem against the transcript's 52rem**, so the writing surface
  sat 16px inside the text it was writing — two columns that should have shared one edge.
- **At `xl` the header's story-panel button opened a drawer that is `xl:hidden`.** Inert at
  every width where it was visible, and it rendered as two near-identical panel icons in the
  same corner, the lower one for a panel that never appeared.
- **`--accent-ink` was the wrong ink for a story portrait.** It is defined to read on the
  *live* accent, but a portrait is drawn on the story's **own** theme ground, and a story
  keeps the theme it was written under. A `daylight` story listed while the studio sits in
  `ink` got `#fdf8ef` ink on a parchment gradient — effectively invisible. The same reason the
  swatch gradients are literals applies, and the fix is the same shape.

## Decision

**The rail is a conversation list with one shared implementation and one shared band
height.** Concretely:

- **`--topbar-h: 3.5rem` and a `.topbar` class** are the single definition of the chrome
  band. The library rail, the app header and the payload rail all use it, so the divider
  under them is one continuous line. `min-height` rather than `height`, because
  `pt-safe` adds a notch inset on a phone and a fixed height would squeeze the content.
- **A story reads as a conversation**: an initial-in-a-tinted-square portrait keyed to the
  story's own theme, its title, and one line of `words · cost · hit rate`. That is the
  same avatar-and-name grammar the transcript uses.
- **Stories are filed by calendar day** — Today, Yesterday, This week, A while ago — via
  `dayBucket` in `shared/text.ts`. Day-boundary arithmetic, not elapsed hours: a story
  written at 11pm must file under Yesterday the next morning, which a 24-hour window gets
  wrong.
- **`LibraryList` is one component with two hosts.** The rail renders it; the phone's
  navigation sheet renders it and is now the only route to the library on a small screen.
  `StudioNav` — cast, cost, settings, transfer, duplicate — is likewise one list in both, placed
  *below* the stories where the list is the point.
- **The rail version of `StudioNav` is compact** (one line per row, hint in the `title`);
  the sheet keeps the two-line rows. Same component, `compact` prop.
- **Row actions are one labelled menu**, `StoryActions`, `position: fixed` and placed from
  measured geometry. Floating it is not a style choice: both hosts are `overflow-y-auto`
  scrollers, and an absolutely positioned popover is clipped by its scroller *whichever way
  it opens*, so the last story in the list would silently lose its Delete item. Fixed
  positioning has no clipping case; the price is dismissing on scroll.
- **The `left` drawer is deleted.** `Drawer` is now `'right' | 'nav' | null` — the library
  is a list inside the nav sheet, not a second sheet that can drift from the rail.
- **The story-panel button in the app header is `xl:hidden`.** Below `xl` it opens the
  drawer and is the only route to the story panel; at `xl` the panel is the payload rail
  with its own toggle.
- **The composer column matches the transcript's 52rem**, so the prose's edge and the
  writing surface's edge are one line.

The rule this generalises: **chrome that appears side by side is one band, defined once.**
Three independently padded headers is what produced three divider heights; a shared class
makes the alignment structural rather than a coincidence someone has to maintain.

## Verification

Measured in the running application through the browser, not eyeballed:

- **Band alignment**: at 1920 / 1440 / 1280 / 1024 px the library band, app header and
  payload rail all report `bottom: 56px` (was 57 / 42 / 32).
- **No overflow**: `document.documentElement.scrollWidth === clientWidth` at 1920, 1440,
  1280, 1024, 900, 768, 430, 390, 360 and 320 px. The rail's own scroller and a story row
  were checked for inner overflow separately.
- **Column alignment**: transcript column and composer column both report
  `left: 332, right: 1164` (was 48rem vs 52rem).
- **The menu clears its scroller**: with the rail's scroller deliberately squeezed to
  180px, the menu reports `top: 163` against a scroller of `56…236` — outside the clip
  region and inside the viewport. Under the previous absolute positioning the same case
  put the menu at `top: 21`, above the scroller's own top edge, clipped.
- **The menu acts on the right story**: with a story row's menu open, "Prompt settings"
  opened a dialog reading *Story settings* for that row's story, and the menu had closed.
- **The phone sheet carries the library**: at 390px the nav sheet reports the `Library`
  band, `New story`, the search field, a `Today` group with a story row, and `This story`
  / `Scenes` / `Studio` / `Theme` sections.
- **The duplicate toggle is gone where it was dead**: at 1024px the story-panel button is
  `display: flex` and opening it sets `aria-expanded="true"` with the drawer's `panel-cast`
  visible; at 1280 and above the same button reports `display: none` while the payload
  rail's own toggle is the visible one.
- **Every chrome band is 56px**: the rail's, the app header's, the payload rail's and the
  drawer's all report `bottom: 56` — four bands, one number, including the drawer form the
  first pass had left at its old `py-2` height.
- **The portrait's ink is per-theme**: the portrait initial resolves to `rgb(27, 18, 6)`
  against the `ink`-grounded portrait rather than the washed-out `--accent-ink`.
- **No console output**: zero errors and zero logs after a reload.
- `npx tsc --noEmit` exits 0; `npx vite build` succeeds.

## Alternatives considered

**Keep the rail as a story list and only fix the header heights.** Rejected as answering
the wrong half. The alignment was the visible symptom; the reason a writer could not find
their last story was the flat undated list, and the reason a phone had nothing at all was
the dead drawer.

**Keep each header's padding tuned to match.** Rejected — that is precisely the arrangement
that produced three heights, and it silently breaks the next time one header gains a line of
text. One class is the fix that does not need re-tuning. The drawer proves the point: it was
missed on the first pass because it is a fourth band in a different file, and adding
`.topbar` to it was the whole fix.

**Make the rail a tab bar / icon rail.** Rejected: an icon says nothing about a story, and
the library is the one surface where a title is the information. The
[instrumentation note](2026-09-22-progressive-disclosure-of-instrumentation.md) makes the
same argument for the phone sheet's labelled rows.

**Wrap the story menu in a portal to escape the scroller instead of using `fixed`.**
Rejected as strictly more machinery for the same result: a portal needs a container, a
document-level click-away owner and its own stacking-context reasoning, where `fixed` plus
a measured position needs neither. The dismiss-on-scroll behaviour is the one thing a
portal would avoid, and it is cheap.

**Keep `drawer === 'left'` for the phone and open it from the header.** Rejected: two
drawers each holding part of the library means a story row and its actions exist in two
implementations, which is the drift this codebase's barrels and one-definition rules exist
to prevent. Folding the list into the existing nav sheet removed code rather than adding
it.

## Consequences

- **The rail is taller than the list needs on a short window.** New story, Studio, search
  and the day headers all precede the first row. Accepted for now: the day grouping is
  what makes a long library navigable, and a scroll is one gesture. If it proves
  irritating the search field is the first thing that can fold.
- **`dayBucket` is in `shared/text.ts` because the web bundle reads it**, which is the
  constraint that file exists for. A server-side reader of the same bucketing would use
  the same function rather than a second copy.
- **`THEME_COVER` changed shape** from `Theme → string` to `Theme → { ground, ink }`, so a
  portrait can no longer be drawn with an ink from a different theme. Its one caller was
  updated; a second consumer added later gets both values from one lookup instead of
  pairing two tables by hand.
- **The one remaining `xl` asymmetry** is that the app header's story-panel button
  disappears at `xl` while the rail's toggle appears. That is intentional — they are the
  same destination reached two ways — but it is a rule a reader has to know, so it is
  commented at the call site.
