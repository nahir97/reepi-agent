# Agent Note: The creation assistant writes the world, not the prose

Status: implemented

## Problem

Reepi could build a world, but only by hand. A writer with a premise had to invent every card
in the cast page, file every lore entry in the inspector, and write the scenario, the bible, the
genre and the style in the story settings — four surfaces, in the order the writer happened to
find them, with no help from the model they were already paying for.

The app already had the machinery for everything except the assistant: four side-channel passes
that read the story and write small durable artefacts
([narration carries no tools](../architecture/2026-09-22-narration-carries-no-tools.md)), a card library that
outlives its home story ([cast is a library](2026-09-22-cast-is-a-library.md)), a prompt-template
library, per-story lore entries, and a story-graph writer (`writeStoryBundle`) that import and
duplication already trust. What was missing was an agent whose *tools* are those DAOs.

The design questions were not about plumbing. They were:

1. Does the assistant write directly, or hand back drafts the writer accepts the way a Director
   note is accepted?
2. May it replace directive text the writer already wrote — the scenario, the story bible, the
   contract?
3. May it revise a card or an entry that already exists, or only ever add?
4. Does it work only inside an open story, or can it mint one?
5. Where does its conversation live?

## Decision

**A fifth side-channel pass, `src/server/agents/creator.ts`, with eight tools, exposed as one
route (`POST /api/creator`) and one page (`CreatorPage`). Its conversation is session-only; its
output is ordinary rows.**

**It writes directly, not into a queue.** A Director note is a *suggestion about an existing
scene*; a character card is *new material the writer asked for by name*. Requiring a second
accept click for "write me four lore entries" would make the tool worse than doing it by hand.
What replaces consent-by-queue is consent-by-receipt: the turn returns a named list of everything
created, everything revised, everything refused, and every frozen block it replaced.

**A block with text is only replaceable with an explicit per-request flag.** `set_story_block`
writes an empty block directly and refuses a non-empty one unless the request carried
`allowOverwrite: true`, which the page exposes as a labelled checkbox that is off by default.
The prompt tells the model the same thing, but the prompt is not the mechanism — a rule the model
can be talked out of is not a rule, and the writer's own prose is the one thing here a bad
generation could destroy. The refusal is reported to the writer in words, not just in model
prose: it lands in `refused[]` and on the page.

**Create *and* revise, but only for characters and lore entries.** A writer who says "make Mira
older" is asking for the obvious next thing; matching by name and patching only the named fields
is cheap and is what the DAOs already do. Prompt templates stay create-only: those are the
writer's own reusable text, and a model overwriting them by name is a clobbering accident waiting
for a request shaped like a template name.

**No delete tools, and no persona tools.** Personas are the writer's own mask and were excluded
by request; deletion is a deliberate act with a confirm dialog, not something an agent should be
able to do from a chat box.

**A 1:1 chat refuses new cards and cast additions.** A chat's cast is its `character_id` — one
borrowed card — so a card written there would be a row the composer never reads: the invisible
orphan the library route already refuses for the same reason. Revising the chat's own card is
allowed, because that is the card the chat is about.

**Everything staged in a turn is applied in exactly one transaction.** Tool calls during the loop
write nothing — each stages a draft and answers with an outcome string, and the drafts are
drained after the loop stops. This is what makes "a story and its cast" one unit of work:
`transaction()` is not re-entrant, so the only way to create a story *and* its cards atomically is
to own the outer transaction. The one refactor this needed was exporting the story-graph writer
without its wrapper (`writeStoryBundle` in `src/server/routes/library/bundle.ts`;
`recreateStoryBundle` still opens the transaction for every other caller).

**Caps are server-side constants** (`CREATOR_LIMITS`): 6 rounds, 24 objects, 12 characters, 20
lore entries, 6 templates, 8,000 characters per block, 2,000 per card field, 4,000 per lore body.
Excess calls are refused with a reason and the rest of the batch still applies — a partial success
that is *reported* is better than a whole request that fails because the model miscounted.

**The conversation is the page's, not the studio's.** The log lives in the zustand store and the
page sends it back as bounded `history` so a follow-up can say "the second one". The durable record
of a turn is the rows it wrote, which the client re-reads through the ordinary bundle, cast-library,
template and plan reads after every turn. A reload loses the conversation and keeps the world —
the same bargain every other agent makes.

**The receipt includes the cache consequence.** A model call never touches the narration payload
(`includeTools` stays `false`), but what it *writes* does. Measured on a scratch story, one turn
that added one card (439 tokens) re-priced exactly the cast block and everything behind it, and
nothing before it:

```
before   stable prefix 1737 tok · predicted hit rate 0.671 · cast 917 tok
after    stable prefix 1737 tok · predicted hit rate 0.573 · cast 1356 tok  (changed)
```

The page shows the moved blocks from the server's own plan and puts the existing warm-up one press
away, because "which blocks did that cost me" is the only number that matters after a write.

**A mistake worth recording.** The first version filtered the offered tools by world state: with no
story open, the model saw only `create_story` and `create_template`. A request for "a story with two
officers" then produced a story, no cast, and a reply claiming the officers were cast — the model had
no tool to call and narrated the outcome instead. Filtering tools by preconditions is the wrong
economy: a tool that refuses with a readable reason teaches the model what to do first, and an
absent tool teaches it to lie. It also silently disabled the one flow the design was built for
(create a story and its cast in one turn). Now every tool is always offered, and absence is answered
by the brief and by refusal at call time.

## Alternatives considered

**A proposal queue, mirroring Director notes.** Every created row would arrive as a draft the
writer accepts individually. Rejected: it makes the assistant slower than doing the work by hand
for the common plural request, and the Director's note queue exists because a *note* is advice
about prose the writer is mid-way through — a card is material, and material can be edited or
deleted after the fact. The receipt plus the existing editors give the same control without a
second consent gate.

**Never replace a block; always return a draft.** Rejected, but narrowly. It is the safest option
and it was the runner-up; it loses because "write me a story bible" for a story whose bible is a
placeholder is a legitimate one-action request, and because the guard only has to hold when the
writer has *not* asked for it. The flag keeps the safe default while leaving the useful case
reachable.

**A `creator_messages` table, so the conversation survives a reload.** Rejected: the durable thing
is what the assistant made, and that is already in the ordinary tables and visible in the ordinary
surfaces. Persisting the chat would add a second transcript with its own lifecycle, deletion rules
and staleness, to preserve something no writer has ever asked a writing tool to remember. It also
would not be free: a third message store is a third place a "history" block could be assembled and
mistaken for the narration's.

**Adding the tools to the narration request.** Rejected before it was considered — this is exactly
what [narration carries no tools](../architecture/2026-09-22-narration-carries-no-tools.md) forbids. The pass runs
its own context precisely so the narration prefix keeps no `tools` array and no reasoning echo.

**Splicing the assistant's reply into the transcript as a message.** Rejected: the transcript is
the story. An assistant that "says" what it is about to write would be a character in the prose;
the receipt is a studio artefact and belongs on a studio surface.

**A bulk `create_lorebook` tool taking an array of entries.** Rejected: DeepSeek returns several
tool calls in one assistant message and the loop already applies every call in a round, so eight
entries are eight calls in one round — one round trip. A bulk tool would add a second schema, a
second cap and a second validation path for no saving.

## Consequences

- **The world can now be built in one sentence**, including a whole story with a cast and a
  seven-entry lorebook in a single request. That request is one `transaction()`: it either lands
  complete or leaves nothing.
- **Spend is attributable.** `CostEventKind` gained `creator`; the cost panel labels it and the
  ledger separates it from narration. The compile error that adding a kind without a label
  produces is the enforcement, not a review habit.
- **A write is visible as a cache event.** Adding cards or rewriting a block is the most expensive
  thing a writer can do to a warm prefix, and the page now says which blocks moved instead of
  leaving the writer to discover it in the hit-rate trend.
- **The brief is bounded but not exact.** The model sees block lengths, truncated bodies, cast
  names with weights, lore titles with keys, library names and template names — not the full
  transcript. It cannot therefore revise something it was not shown, and it can propose a
  duplicate of a lore entry whose title differs only in punctuation (the duplicate check is
  case-insensitive, not fuzzy).
- **Partial success is a supported outcome.** A batch that exceeds a cap applies what fits and
  reports the rest; a batch whose *apply* throws applies nothing. Those are different guarantees
  and the second one is the one that matters.
- **`writeStoryBundle` is now a public door that must be used inside a transaction.** Its comment
  says so; nothing enforces it. `recreateStoryBundle` remains safe and is what every other caller
  uses, so the surface is one function wider than it was.
- **The page's log is lost on reload.** Deliberate, and the mitigation is that everything the log
  described is visible where it landed — the cast page, the inspector's lore section, the story
  settings, the template dialog.

## Testing

`npm run typecheck`, `npm run verify:notes`, `npm run verify:store` (121 checks) and
`npm run verify:tx` all pass. The route was exercised live against a scratch database:
three-entry lorebook, two characters cast, a guarded rewrite refused and then allowed, and a
story created with two officers and seven lore entries. A throwaway probe drove the real
dispatcher and the real apply path for the claims a happy path cannot reach — refusal without
consent, replacement with it, duplicate-name refusal, a chat refusing a second card while allowing
its own card to be revised, and a mid-batch failure rolling the story and its cast back — 23/23.
