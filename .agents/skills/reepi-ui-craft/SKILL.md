---
name: reepi-ui-craft
description: Use when building or changing any user-visible surface in reepi-agent — a component, layout, theme, panel, dialog, or interaction; when adding a number or metric to a screen; when something looks visually cluttered; and when deciding whether new information should be visible by default or disclosed on intent.
---

# Building reepi's interface

Reepi is a writing instrument for roleplay and long-form prose. The interface exists to serve
sustained reading and writing, and the product's differentiating feature — a live account of
what the cache saved — is *instrumentation*, which is the natural enemy of that.

This skill is about holding that tension deliberately.

## The governing rule

**Show a number by default only if the writer must act on it to keep writing.**

Almost nothing qualifies. Cost is not shown by default even though cost is the product's
thesis. Hit rate is not shown. Token counts are not shown. They are all one action away, and
that distance is the design.

The failure this guards against is real and was shipped once: an interface with a payload meter
above the composer, four to seven usage chips under every turn, and a seven-tab rail always on
screen. Every number was accurate and relevant. The result was hostile to writing — the
instrumentation competed with the prose for the same pixels and the prose lost. See
`.agents/notes/implemented/feature/2026-09-22-progressive-disclosure-of-instrumentation.md`.

Before adding anything visible, name which of these it is:

- **Must be known while writing** → visible. Rare: the current scene, the speaker of a turn.
- **Worth knowing deliberately** → disclosed on intent. The payload analysis, the cost ledger,
  the turn's usage figures.
- **Interesting once** → do not ship it as a persistent surface.

## Adding a metric

When you do add one, three questions, in order:

1. **Who acts on it?** If the answer is "nobody, but it's interesting", it belongs in the cost
   panel or a note, not on the writing surface.
2. **What is the honest comparison?** A cost figure means little alone. `$0.00048` is data;
   `$0.00048, and $0.00082 without the cache` is a decision. Numbers here should carry the
   counterfactual that makes them actionable — the cache multiplier, the saved-vs-cold pair,
   the naive-client comparison.
3. **Would a wrong value be noticed?** If not, it needs a test. Every figure the interface shows
   comes from the server's own accounting, and the client never invents one.

## Interaction conventions

**Instrumentation folds, it never deletes.** A disclosure is the right shape because the writer
who wondered gets the answer and the writer who did not loses nothing. `Turn details` and the
composer pill both work this way, and the folded line keeps a summary visible so the affordance
is discoverable.

**Hover-reveal is not disclosure.** Touch devices have no hover, and a control that appears on
hover is a control nobody finds. Row actions start dim rather than invisible.

**Never cover the composer or the prose.** Floating controls are a last resort. This is why the
theme picker lives in the library rail and the navigation sheet rather than as a floating
button.

**Accessibility is not a phase.** Every control carries a label a screen reader can read, the
focus ring is never removed, and colour is never the only carrier of meaning — a hit rate is a
number before it is green.

## The visual language

Warm, literary, and restrained. The register is a printed book that happens to be a program.

- **Typefaces have jobs.** Fraunces for display, Literata for long-form reading, Inter for
  chrome, JetBrains Mono for metrics. A number in the UI is a metric and gets tabular figures.
- **Dialogue is the loudest ink.** In roleplay the spoken line is the point, so it is rendered
  in a warmer, heavier colour than narration. This is a functional choice, not decoration.
- **Every theme is real.** Four themes (`ink`, `ember`, `verdant`, `daylight`) with `daylight`
  a genuine light theme, not a dimmed dark one. A swatch previews a theme you are *not* in,
  which is why the gradient values are literals rather than `var(--accent)`.
- **No emoji.** No icon fonts. Icons are hand-drawn inline SVG on one stroke weight.

## Layout facts that are load-bearing

- **The transcript is the product.** It takes the widest share on desktop and the whole width
  on mobile. Anything competing for that space needs the strongest justification.
- **Bubbles cap useful width.** The chat format narrows a very long turn compared to the
  manuscript layout it replaced. That was accepted deliberately — see the disclosure note — and
  is not a bug to fix by widening the column.
- **Verify at every width.** Measure `document.documentElement.scrollWidth` against
  `clientWidth` at 320, 360, 390, 430, 768, 1024, 1280, 1440 and 1920. Overflow is invisible in
  a screenshot of the overflowing element; the number is the check.
- **Mobile gets the same information, not less.** The navigation sheet is a chart of every
  destination with a plain-language hint, because a phone screen belongs to the prose and a tab
  bar of icons would say nothing.

## Prove it visually

Compiling JSX proves nothing about layout. Open the app, take a screenshot, and read the DOM for
the values that matter — bubble count, avatar images resolving (`<img>`, not the initials
fallback), the folded disclosure present, and no horizontal overflow. A change to a surface is
verified when you have looked at that surface.

Report what you saw, not what you intended. "Zero overflow at all nine widths, six bubbles, four
portraits resolving, zero console errors" is a result.
