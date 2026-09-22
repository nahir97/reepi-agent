# Agent Note: Prompt templates and macros

Status: implemented

## Problem

Every prompt block was hand-written, per story. Two blocks — the voice contract and the prose
style — are the same text for most writers across most stories, and there was no way to keep a
house style once and apply it anywhere. Worse, the only way to write *"the model must address
my persona by name"* was to type the persona's name into a frozen block, which then went stale
the moment the persona was renamed, and which broke the moment a story was duplicated or a
character chat was started from it.

The default contract had already made that mistake. It reads *"Second person for `{{user}}`,
third person for everyone else"* — and `{{user}}` was being sent to the model **literally**,
braces and all, because nothing expanded it. The placeholder syntax was in the product from the
first commit and no code behind it existed.

Three things were needed:

- Reusable block text, savable once and applicable to any story.
- A macro language that resolves against the story at the moment a payload is built, so text
  stays live: a template that says `{{user}}` keeps working after the persona changes.
- A boundary: this is the writer's *system prompt*, not the machinery. The Director's tool
  schemas, the agentic passes' prompts, and the narration request's `tools` handling are not
  text the writer should be editing.

## Decision

**A prompt template is a named set of block texts; a macro is a `{{name}}` token resolved from
the story every time a payload is built.**

**The entity.** `prompt_templates` (id, name, blurb, `blocks` JSON, `sort_order`, timestamps).
`blocks` is a map of editable block → text, so a template fills one block (the common case) or
several (a "house voice" preset that sets genre and style together). Seven blocks are
authorable — `contract`, `genre`, `style`, `story`, `scenario`, `exemplars`, `instruct` — held
in one table, `EDITABLE_BLOCKS` in `shared/types.ts`, which the story editor, the template
editor and the route's validator all read. Every other block is rendered from rows (cast,
persona, transcript) or written by an agent, so it is not templatable and cannot be a target.

Templates are **app-scoped, not story-scoped**: the point is reuse, and a story that borrowed a
template row would break when the row was deleted. Applying therefore **copies text**, and
writes through the existing `PATCH /api/stories/:id` — there is no apply endpoint, and no second
way for a block to change. Stored text keeps its macros unresolved, so applying is not a
one-way bake.

**Code-shipped starters, not seeded rows.** Five templates ship as constants in
`src/server/templates.ts` and are merged into `GET /api/templates` with `builtin: true`. A
release can correct one without a migration, and "edit" for a built-in means "duplicate it", so
the writer's library never changes underneath them. Writing to a built-in id is a 409 with the
reason, not a silent no-op that looks saved.

**Macros resolve at compose time, in one place.** `shared/macros.ts` is the registry of names,
labels, groups and hints; `src/server/macros.ts` holds ``RESOLVERS: Record<MacroName, …>``, which
makes a registered macro without a resolver a compile error. `composer.ts` calls `expandMacros`
inside its `push()`, so the block hash, the token count and the inspector's preview all see the
resolved string. Nineteen macros, in four groups: identity and cast (`char`, `description`,
`personality`, `speech`, `charScenario`, `castNames`), persona (`user`, `persona`), world
(`title`, `genre`, `style`, `scenario`, `bible`, `exemplars`, `synopsis`), scene (`sceneTitle`,
`state`, `threads`, `targetWords`). They read what the payload reads: cast resolution and the
persona pool come from `castOf`/`resolvePersona`, the same helpers the composer uses, so a
character chat's `{{char}}` is the card it borrows and its `{{user}}` is the borrowed pool's
persona.

Syntax rules, all deliberate: lookup is case-insensitive and tolerates inner spaces
(`{{ User }}`); an unknown name is **left verbatim** (predictable, visible in the inspector, and
flagged in the editor, where silently deleting it would look like the template worked);
expansion is **single pass**, so a value introduced by one macro is never rescanned; an empty
value substitutes empty text. `{{scenario}}` is the story's Scenario block and a card's own
scenario is `{{charScenario}}` — the one place this diverges from SillyTavern, whose
`{{scenario}}` means the card's, and the registry's hint says so where the writer will read it.

**The transcript is exempt.** Every block expands except `history`, and the writer's own
just-typed turn is never rewritten either. The transcript is a record, not a template: it must
stay byte-stable as it grows, and re-rendering it from live state would rewrite the cached
prefix (rank 8) every time a persona was renamed. The corollary matters just as much: expanding
a fresh turn but not its stored form would make the tail of the transcript differ from what was
actually sent, which is a miss on *every* turn instead of a feature. Depth-mounted lore and the
assistant prefill *are* expanded — they are authored text rebuilt each turn like any block — and
they are outside the block list, so their expansion is not itemised in the inspector.

**Greetings are the one write-time expansion.** A chat's greeting becomes transcript, so
`chats.ts` expands it once, before insert, against the chat's own context. Imported SillyTavern
cards put `{{char}}` and `{{user}}` in exactly that field. Nothing is backfilled: an existing
conversation is never rewritten.

**Tools stay out.** The templating surface stops at the seven author-editable blocks. The
Director's `DIRECTOR_TOOLS` schemas, every agent prompt in `src/server/agents/`, and the
narration request's `tools` handling remain code. Those prompts have structured output contracts
(a Director that can be talked out of `set_scene_state` is a corrupted ledger, not a customised
assistant), they are side-channel calls with their own cache behaviour, and the narration path
deliberately carries no tools at all.

**Where it lives in the UI.** A `Prompt templates` row in the studio nav and a command in the
palette open one dialog: the library on the left, the editor on the right, with the macro
reference resolved for the open story. Inside Story settings, every block header carries
`Templates ▾` (that block's templates first, the rest under a divider — a template is text, so
cross-block insertion is offered rather than forbidden) and `Macros ▾`, and a chip line under
each field shows every macro it uses and the value it will carry. The template editor's
`Apply` asks in its own footer rather than in a confirm dialog, because the store holds one
dialog slot and a confirm would discard an unsaved template to answer a question about a
different thing.

**Copy.** The New-story starter kits are now called "starting points" everywhere they are
visible, because two different things called "template" in one UI is a defect. Code identifiers
(`TEMPLATES`, `StoryTemplateId`) are unchanged.

## Alternatives considered

**A story-scoped template table.** Rejected: templates are the thing you carry between stories,
and a story pointing at a template row would either break on delete or need a cascade that
silently changed a story's prompt.

**Seeding the starters as rows on first boot.** Rejected: a shipped starter could then only be
corrected by a migration, and "editable" would have to mean "editable in place", which is how a
writer loses text they relied on when the app updates.

**Baking resolved values at apply time.** Rejected: it freezes a live value into a block, goes
stale on rename, and would make the same template produce different text in different stories
with no way to see why. It also removes the whole point of a macro — a template that says
`{{user}}` is correct for every persona.

**A client-side macro resolver for previews.** Rejected: two resolvers drift, and the reference
panel would promise values the payload does not produce. Values come from
`GET /api/macros?storyId=`, computed by the composer's own resolver.

**Recursive expansion.** Rejected: a character description containing `{{char}}` would either
loop or expand into text nobody wrote. Single pass, documented.

**A date/time macro.** Rejected outright: anything volatile in the prefix invalidates every
block behind it, and a timestamp does that once a day, forever, silently. Same reasoning excludes
model/effort/temperature macros and any macro over memory or recall — that material is already
injected each turn, in the tail.

**A `{{cast}}` macro that dumps every card.** Rejected: the cast block already pays for those
tokens, so the macro would bill them twice. `{{castNames}}` is the cheap version of the same
intent.

**An escape hatch for a literal `{{name}}`.** Rejected as a half-built feature: an unknown name
is already passed through verbatim, which covers survival of the text without inventing syntax.

**Putting the macro reference in a floating popover.** Rejected: the hosting surfaces scroll, and
an absolutely positioned panel inside a scroll container is either clipped or needs the measured
anchor machinery the story rows use. The panel is inline instead.

## Consequences

- A house style is written once and applied in one action, from Story settings or the library,
  and it keeps resolving against whatever story it lands in.
- The default contract now says "Obey Aleron." rather than "Obey `{{user}}`." — a behaviour fix
  that costs one deliberate cache re-price (below).
- Imported SillyTavern cards work better: `{{char}}`/`{{user}}` in descriptions and greetings
  now resolve instead of reaching the model as braces.
- A macro in a frozen block ties the prefix's stability to the value it reads. A persona switch
  now invalidates from the contract block, not from the persona block — a real, larger re-price
  — so `buildWarnings` names the macro and the block when it detects one, and Story settings
  says it in the pending-edit banner.
- `BLOCK_ORDER` did not change; no block moved. Only the text of the blocks that contain macros
  differs from before.
- Per-block token counts in the editors are the *unresolved* text; the inspector's are the
  resolved text the model reads.
- Templates are app-global and are not part of story export/import bundles. A fresh database
  starts with the built-ins. If a portable corpus is wanted later, that is a bundle-format
  change with its own note.

### Cache cost of shipping this

`DEFAULT_CONTRACT` contains `{{user}}` three times and had been sending it literally. Resolving
it changes the `contract` block — rank 0 — so **the first turn after this upgrade misses the
entire prefix, once, per story**, and the turn after that caches again from the new text. Nothing
is backfilled, so each story pays it on its own next turn, and the cache-warm action exists for
anyone who would rather pay it deliberately.

Measured on the real database (a read-only copy, via `POST /api/plan`): the group story's
previous turn measured 91.2% with a 2,739-token cached prefix; after the change the plan reports
`contract` as the **only** changed block (`stablePrefixTokens: 0`, predicted 0.0% for that one
turn) with `genre` through `history` all stable. Measured live on a throwaway story
(`npm run verify:cache`, three turns): turn 1 `0.0%` at $0.00040, turn 2 **87.3%** (drift −2.8pt)
at $0.00014, turn 3 80.9% (drift −10.7pt). Steady state is unchanged from the 85–88% band the
cache note documents; the third turn's drift is the known tail effect of the model's own prose
growing the transcript, not this feature.

## Testing

`npm run verify:store` grew from 37 to 74 checks: template CRUD and JSON round-trips, the
corrupt-blob and non-editable-key paths, and nineteen macro assertions — first-card vs borrowed
cast, the persona pool, case and spacing, unknown-left-verbatim, non-recursion, empty values,
the reported name list, and the catalogue with and without a story. Four of them pin the
composer's boundaries: a directive block expands and reports it, the prefill expands, a macro
typed into a message stays literal in the transcript, and the writer's own turn is untouched.

`POST /api/plan` on the real story shows the resolved contract, `macros: ["user"]`, and the
frozen-block warning. The browser was driven through the whole flow — palette and nav row,
duplicate, macro insert (appending when the field was not the one in use), save, the footer
confirm, and the applied text reappearing in Story settings with its macro chip. Zero document
overflow and zero console errors at 320/360/390/430/768/1024/1280/1440/1920, including with the
inline template menu and macro reference open inside a block card (which caught one real defect:
a nowrap value chip overflowed a 320px card by 43px until it was ellipsised).
