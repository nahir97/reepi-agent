# Agent Note: Progressive disclosure of the cost instrumentation

Status: implemented

## Problem

The first version of the interface put every number the product computes permanently on
screen: a payload meter above the composer, four to seven usage chips under every turn, a
seven-tab inspector rail always visible on wide screens, and a sidebar carrying two theme
pickers with explanatory prose beneath each.

Every element was accurate and every element was relevant to the product's thesis. The result
was hostile to the activity the product exists for. A writer mid-scene does not need to know
that a turn cost $0.00048; they need to keep writing. The instrumentation was competing with
the prose for the same pixels, and the prose — the entire point — was losing.

The specific failures, from screenshots of the shipped interface:

- Usage chips under every turn formed a dense band that broke the transcript's rhythm and made
  a conversation read as a dashboard.
- The composer's meter was a multi-line block, taller than the text field it sat above.
- The inspector rail occupied 22rem permanently on wide screens, whether or not the writer
  wanted to look at the payload.
- Two theme pickers with two paragraphs of prose explained a distinction the writer was not
  making.

## Decision

**The default view of a turn is the writing and nothing else. Every number is one action away,
and none is on the default screen.**

Concretely:

- **Turns render as chat bubbles** with an avatar, speaker name and prose — the writer's own
  turns aligned right in the accent, the story's aligned left. This reads as a conversation
  rather than a manuscript with margin notes, and the speaker is legible before a word is
  read.
- **Per-turn instrumentation folds behind a `Turn details` disclosure** carrying hit rate,
  hit/miss tokens, output, cost, saved-vs-cold, time-to-first-token, billing period and the
  lore entries injected. All of it is retained; none is shown by default.
- **The composer's meter is one pill** — predicted hit rate, this turn's cost, and the saving.
  Tapping it opens the full payload analysis.
- **The inspector rail collapses to a slim button** on wide screens, and the preference is
  remembered.
- **Two theme pickers became four swatches in one row.** A story's own theme moved into its
  settings dialog, where the writer is already making story-level decisions.

The rule that generalises: **a number is shown by default only if the writer must act on it to
continue writing.** Everything else is disclosed on intent. Under that rule almost nothing
qualifies, which is the point.

## Verification

Verified against the running application at nine viewport widths from 320px to 1920px: zero
horizontal overflow at every width, and zero console errors. A real streamed turn was sent
through the composer and its cost pill observed updating (46% → 75% cached as the transcript
grew), with the turn details disclosure opened and read.

The folded instrumentation is genuinely present, not removed — checked by opening the
disclosure and reading the API's own usage figures from it.

## Alternatives considered

**Keep the instrumentation and accept the density.** Rejected because the product's purpose is
creative writing. A tool that makes its own cost thesis more prominent than the writing is
optimising for the demo rather than the use.

**Remove the instrumentation entirely.** Rejected: the cost discipline is the reason the
project exists, and a writer who cannot see what a turn cost cannot learn to keep the prefix
warm. Removal would hide the product's actual value. Hiding it by default is not the same as
deleting it.

**Move everything into a single "advanced" mode toggle.** Rejected as a worse version of the
same idea: a mode switch is a coarse instrument that forces an all-or-nothing choice, whereas
per-element disclosure lets the writer open exactly the number they wondered about.

**Show instrumentation only while the composer is focused, or on hover.** Rejected because it
couples the display of unrelated things. A writer may want the cost panel open while the prose
scrolls, and a writer may want neither. Hover states are also unavailable on touch.

**Keep the transcript as wide, unboxed prose in the manuscript style.** Rejected after seeing
both. The manuscript layout was beautiful but it did not read as a conversation, and the
speaker of a turn required reading the label. Bubbles with avatars make a multi-character
scene legible at a glance, which is what roleplay with a cast requires.

## Consequences

- **Discoverability cost.** Instrumentation that is hidden is instrumentation a new writer may
  never find. Mitigated by keeping the folded summary visible as a one-line affordance, and by
  the command palette listing the cost panel explicitly.
- **Two clicks to the payload.** Reading the full block analysis now costs a click on the pill.
  Accepted: that analysis is worth reading deliberately and not worth reading while writing.
- **The chat metaphor is a constraint.** Bubbles cap useful width, so a very long turn reads
  in a narrower column than the manuscript layout allowed. Accepted as the trade for a
  conversation that reads as one.
