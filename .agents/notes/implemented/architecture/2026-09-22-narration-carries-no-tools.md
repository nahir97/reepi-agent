# Agent Note: Narration carries no tools

Status: implemented

## Problem

Reepi has real agentic capability — a Director that plans beats, an Archivist that distils
durable facts, a Summariser, a Conductor that drafts variants. The obvious implementation is
one request with tool definitions attached, letting the model call them mid-turn. That is how
most agentic chat applications work, and it is how the first version worked.

It was also the single most expensive mistake in the codebase, for reasons that only show up
when you read the wire protocol carefully.

**A request carrying `tools` forces DeepSeek to require the full `reasoning_content` echoed
back on every subsequent turn.** The reasoning trace is billed as *input* on the way back,
and it is not cacheable in the way the rest of the prefix is — it grows monotonically with
conversation length. A long roleplay session with tools enabled therefore pays for every
token of every reasoning trace it has ever produced, on every turn, forever.

There was a second, subtler cost. Tool calls and their results are appended *mid-transcript*,
so the history block is no longer append-only at its tail. Every tool result rewrites the end
of the one block the cache depends on.

## Decision

**The narration request carries no tools. Every agent runs as a separate, side-channel API
call.**

`composer.ts` never emits a `tools` array. The agentic passes in `src/server/agents/` each
build their own small context, make their own call, and write their result to the database —
where it becomes an ordinary block (`director`, `retrieval`, `state`), an ordinary row (a card, a
lore entry, a template), or a note the writer can accept. Nothing an agent produces is spliced
into the narration transcript.

The shape has three load-bearing properties:

- **The narration prefix stays pristine.** No tool definitions, no tool results, no reasoning
  traces echoed back. The payload the cache depends on is never touched by an agent.
- **Each agent pays once.** The agent's own cost is recorded to the ledger under its own
  `CostEventKind` and never recurs: what it writes is a durable artefact (a note, a memory,
  a state update), not something the next turn has to re-derive.
- **A pass that reads the story rides the story's cache unit.** As originally written this
  bullet claimed every agent shared the narration prefix. That was wrong, and it is worth
  recording how: the passes built private contexts whose first byte was their own system
  prompt, and a prefix cache shares nothing when the first byte differs. It is true now for
  the passes that were moved onto the story payload —
  [a pass rides the story's prefix](2026-09-23-a-pass-rides-the-story-prefix.md) — and the
  Conductor always had it, because it re-sends the composed payload itself.

`ReasoningEffort` is likewise unrelated: narration sets `effort: 'none'` not only to avoid
paying for thinking tokens but because **thinking mode silently ignores `temperature`**, which
is fatal for creative writing.

**The templating boundary stops at the story's own blocks.** Since
[prompt templates and macros](../feature/2026-09-22-prompt-templates-and-macros.md), a writer can
author and reuse the text of the seven blocks they own (`contract`, `genre`, `style`, `story`,
`scenario`, `exemplars`, `instruct`). Nothing here becomes editable with them: `DIRECTOR_TOOLS`,
the system prompt of every pass in `src/server/agents/`, and the narration request's `tools`
handling stay in code. A prompt whose whole job is to emit a valid tool call is a structured
output contract, not prose — a Director that can be talked out of `set_scene_state` corrupts the
ledger rather than customising an assistant — and those passes are side-channel calls whose spend
is accounted under their own kind. A template may change *what the narrator is told*; it may not
change *what the machinery does*.

**The creation assistant is a pass like the others, and its tools are the routes' own writes.**
Since [the creation assistant](../feature/2026-09-22-creative-creation-assistant.md), a writer can
ask an agent to write cards, lore entries, directive blocks, templates and whole stories. That does
not move this boundary: `CREATOR_TOOLS` is a second side-channel caller of the same DAOs and the
same validators the library routes use, it is offered only inside its own `POST /api/creator`
request, and it can no more reach the narration payload than a Director call can. What it *writes*
is world material, which is exactly the material the frozen prefix is made of — so a creator turn
does re-price the prefix. That cost is deliberately visible on the page (the moved blocks, from the
server's own plan) rather than being a reason to invent a path into the payload.

## Verification

`npm run verify:cache` shows the narration payload holding 85–88% cache hits across turns —
which is only achievable if nothing mid-conversation invalidates the prefix.

The `/api/diagnose` endpoint repeats a ~4k-token payload and reports the measured hit rate,
so the assumption is checked against the API's own accounting rather than asserted.

Each pass records to the cost ledger under its own kind (`director`, `archivist`,
`summarise`, `conductor`, `judge`, `creator`), visible in the Cost & cache panel.

## Alternatives considered

**Keep tools on the narration request and accept the reasoning-echo cost.** Rejected: the
cost is unbounded in conversation length, which is precisely the case roleplay is. A long
session would be dominated by re-paid reasoning tokens.

**Tools on narration, but clear the reasoning traces manually.** Rejected because the API
requires them echoed once tools are declared; dropping them produces a protocol error rather
than a saving.

**One agent with all tools, invoked between turns.** Rejected as a worse version of the same
problem: a single large call replacing four small ones loses the shared-prefix benefit, since
each pass reads a different slice of state and would pay its own miss on the parts the others
do not need.

**Let agents append into the transcript as system messages.** Rejected: it rewrites the tail
of the history block, which is the one block the cache depends on. Agent output is durable
state, not transcript, and belongs in its own block.

## Consequences

- **Extra round-trips.** Agentic work is N calls rather than one. This is affordable because
  the passes that read the story ride its cache unit and the ones that do not are small and
  opt-in: nothing runs on the narration path.
- **No mid-turn tool use.** The model cannot decide to call a tool while writing prose. In
  practice this is a feature for creative writing — the narration stays a single coherent
  generation rather than being interrupted by machinery.
- **Agent output is stale by construction.** A Director brief describes the transcript as of
  when it ran, and the composer labels it as its own block so a stale brief is visible rather
  than silently mixed into history.
- This is the constraint most likely to be violated by a well-meaning contributor adding
  "tool support to the chat route". It is recorded here for that reason.
