# Agent Note: A conversation owns the prompt it was applied from

Status: implemented

## Problem

Applying a prompt template was a **copy with no receipt**. `applyTemplate` wrote the
template's text into the story's own columns through the ordinary PATCH, which was a
deliberate design — a story keeps its words, resolves its own macros, and survives
the template's deletion — and it left one question with no answer:

> *Which prompt is this conversation speaking in?*

The blocks held the answer in principle and never in practice. A writer who applied
"House voice" three weeks ago saw seven textareas; to know whether what they were
looking at was a template or their own edits, they had to remember. The rail grew a
`Prompt` section to report it, and the report could only be honest about the current
session (`ui.appliedTemplate`, cleared by `openStory`) — a reload lost it, because
there was nothing in the database to lose it from. The complaint that arrived with a
screenshot was the next version of the same thing: *"if we could be able to define
the template easily either through the settings of the chat input and the right
sidebar would be appreciated."*

A second, unrelated report arrived attached to it: the composer's settings popover
appeared to ignore the story's settings. It did not — the values were inherited
correctly and the *labels* lied. Every untouched field said `Story default` and no
more, so the popover was the one place in the app that could not tell you what the
story was set to. And the settings control itself was a circle with eight spokes:
a sun.

## Decision

**Add `stories.template_id` — a link, beside the copy.**

`templateId: string | null` on `Story`, `template_id TEXT` on `stories`, via an
additive migration. `null` means hand-written, which is the honest state of every
story that exists and of every story whose blocks have been edited by hand since.

What the column is *for* is narrow and worth stating precisely: it records **which
prompt was applied**, so a conversation can say it, re-apply it after the template
was corrected, and be asked to switch. It does not become the source of the text.
Applying still copies, the blocks are still the story's own, macros still resolve
per turn, and editing the template still leaves every story that used it alone. This
is the difference between a receipt and a pointer, and the whole design keeps it on
the receipt side.

### It is not a foreign key, and that is load-bearing

Five of the six templates that ship are code constants with no row in
`prompt_templates`. An FK on the column therefore rejects `builtin-narrator-contract`
— the most likely value it will ever hold. So the column is a plain `TEXT` and
integrity is the application's, in the two places it can be checked:

- **On the story PATCH**, the id must be a built-in or a stored row, or the request
  is a 400. That is the only write path that can set it.
- **On template deletion**, `stories.clearTemplate(id)` runs in the same transaction
  as `templates.remove(id)`, so a story never points at a template that is gone. The
  route used to be a single statement; it is now a transaction because the link is
  new state that can dangle.

A stale id could only ever mean "no template", never a broken join, because nothing
joins on it.

### One shared picker, two doorways

`PromptPicker` (new, `src/web/components/PromptPicker.tsx`) reads `story.templateId`,
derives the match from `templateMatch(template, story)`, and offers the switch:

- In the **composer's settings popover**, above the turn-scoped controls, with the
  heading `This turn only` still governing what is below it. The prompt is not a
  per-turn override — it is what the conversation *is* — but the popover is where the
  writer already is when they want a different voice, and the two decisions belong in
  one place.
- In the **rail's `Prompt` row**, the first row of `Context`, expanded in place: a
  section-shaped row that opens into the chooser because there is nothing to drill
  into, the prompt *is* the choice.

Both render one component because two implementations of "what template is this"
would disagree within a week about what "applied" means. `usePromptSummary` is
exported beside it for hosts that only report — the row's one line.

`templateMatch` lives in `shared/types.ts` next to `templateStoryPatch`, because it
is the same arithmetic the apply path already had, and the picker, the row and any
future surface must not each derive it.

### The dialog can be aimed

`openDialog({ kind: 'prompt-templates' })` gained an optional `templateId`, so
`Edit`/`Duplicate` opens the library **on the template this conversation speaks in**
instead of at the top of the list. The rail's `Prompts` button and the picker's own
button both aim it.

### Inheritance is stated, not implied

The overrides popover now says what an untouched field will send:
`Story default — Max`, `Story default — DeepSeek V4 Pro`, and a summary line reading
`unset fields inherit the story — Max, V4 Pro`. The values were always right; the
labels were the bug. And `IconSettings` is a proper toothed gear, because the old
spoke-and-circle glyph was reported as a sun twice.

## Alternatives considered

**Keep the session-local record and add a "remembered" badge to it.** Rejected: the
honest version of that badge reads *"you applied this by hand at some point in this
tab"*, which is not the question. The question survives reloads, so the answer has
to.

**A `stories.prompt_blocks` JSON snapshot of the applied template.** Rejected as a
second copy of text the story already holds, and a silent one: the blocks would drift
from the columns on the next hand-edit, and the app would have two answers to "what
does this story say".

**Make `template_id` a foreign key and store built-ins as rows.** Rejected: the
code-shipped starters are constants *so that* a release can correct one without a
migration. Seeding them as rows to satisfy a constraint would trade that away for
referential integrity the application already provides in two checked places.

**Apply-on-switch always, with no confirmation.** Rejected: the picker would be a
control that silently overwrites seven blocks, including the frozen ones at the very
front of the payload. The selection changes immediately and the apply is a labelled
button beside it — except in the picker, where choosing an entry *is* the apply,
because the option text names the blocks it will fill.

**Two pickers, one per host, shaped for each.** Rejected on the usual grounds: the
panel's row and the popover's control look different by layout, not by meaning, and
one component is what keeps them saying the same thing.

## Consequences

- **Applying a whole template now records the link in the same PATCH as the text.**
  A narrowed apply (one block, from the story editor's per-block menu) deliberately
  leaves the link alone: a story is not "speaking" a template half of which is not in
  its payload.
- **A story can be in a third state: linked but drifted.** The picker and the row say
  `${matching}/${filled} match` and the row adds a sentence naming how many blocks
  the writer has edited since. That state is now legible, which it never was.
- **Deleting a template is a transaction, not a statement.** The words stay, the link
  goes, and the row reads `the template was deleted · hand-written now` rather than
  showing a name nothing resolves. `verify:store` pins both halves.
- **The dev database needed rebuilding by hand.** The column was briefly declared as
  a foreign key, which an existing file then carried, and an additive migration can
  only add a column — it cannot drop a constraint. The fix was to drop and recreate
  `stories`/`scenes` and copy the rows back, which is the only mechanism this repo
  has; it is also the concrete reason the shipped column is a plain id. Fresh installs
  and `verify:store`'s fresh file were unaffected, and both now carry the plain column.
- **`ui.appliedTemplate` still has no reader.** It is written by `applyTemplate` and
  the panel reads `story.templateId` instead. It should now be deleted rather than
  kept — it was retained one commit ago on the grounds that a future surface might
  want it, and that surface arrived as a column.
- **The popover grew.** It scrolls (`max-h-[min(80dvh,44rem)] overflow-y-auto`) and
  was measured to fit at 390px without scrolling and at 320px with one.

## Testing

- `npm run verify:store` — **134/134**, three checks added: a story records the
  template it was applied from, deleting a template clears the link, and deleting a
  template keeps the words.
- Live API, on a throwaway story: PATCH with a built-in id links it; `DELETE` on the
  template returns 200 and leaves `templateId: null` with `contract` untouched; a
  PATCH naming an unknown id is rejected **400**.
- Browser, end to end on a throwaway story: the row reads `hand-written`; selecting
  `The narrator contract` from its own picker writes the text *and* the link; after a
  full reload the row reads `The narrator contract · applied` and the composer's
  popover picker shows the same value; a hand-edit to the contract then makes the row
  read `The narrator contract · 0/1 match`. Zero page errors.
- The composer popover at 320 and 390: the picker renders in both, no document
  overflow (`320/320`, `390/390`), the box fits the viewport, and the effort label
  now reads the inherited value.
