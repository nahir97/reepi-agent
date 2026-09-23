# Agent Note: A pass rides the story's prefix

Status: implemented

## Problem

Every agentic pass used to build a context of its own. The Director sent
`DIRECTOR_SYSTEM` plus a brief holding the story title, the genre, the scene state,
the open threads and the last twelve transcript lines. None of those bytes had ever
been sent before, so every Director call was a full miss against a context nothing
else would ever reuse — and the context was then thrown away.

The cost was not the worst of it. The narration payload sitting beside it in the same
story contained the contract, the cast, the anchored lore and the whole transcript:
exactly the material a Director needs to judge continuity and keep scene state
accurate, and exactly what its twelve-line slice left out. So the app paid a private
miss *and* made the worse decision from worse information.

## Decision

**An agentic pass sends the story exactly as the narrator sends it, and puts its own
brief where the narration tail would be.**

The composer grew a `mode` block — last in `BLOCK_ORDER`, so it cannot push anything
back into the shared region — and a `PassSpec`. When a payload is composed for a pass,
everything in front of that block is built by the same code that builds the narration
payload: the same preamble, the same cast and persona, the same anchored lore, the same
transcript window. Only the volatile region is replaced. `readTurnContext` is the single
implementation of that front half, called by both `composeTurn` and `composePass`, so
the two cannot drift into agreeing about the story and disagreeing about the bytes.

Three facts about the resulting payload shape:

- **A pass is a prefix of the story's payload**, so the API serves it from the cache
  unit the narrator's last turn persisted. Measured on `deepseek-flash` against a live
  turn: a Director call reported **2432 hit / 955 miss (71.8%)** for its first round,
  and **4096 hit / 248 miss (94.3%)** for its second. The second round is larger than
  the first because the API persists a unit at the end of the model's *output* as well
  as at the end of its input, so a round following a round hits everything the previous
  one sent and everything it generated.
- **The miss is the new material**: the turn written since the narrator's payload, the
  pass's brief, and the ~580 tokens of tool schemas. It is smallest exactly when a pass
  is most useful — run immediately after the turn the writer is reacting to.
- **Nothing records it.** `composePass` never saves a `prefixes` row. That row is the
  narration's memory of its own last payload, and a pass overwriting it would make the
  next turn diff against a shape it never sent.

The pass's brief has to subordinate the narration contract it now sits behind — "you
are not the narrator in this call, and you do not write prose" — because the contract in
front of it says the opposite. That is the one real quality risk in this shape.

## Alternatives considered

**Give every pass the same tools array so they "share the configuration".** Measured and
rejected as a mechanism. Tool schemas render *after* the messages — a tool-bearing
request reused 100% of a tool-free request's complete blocks — so a shared array buys no
sharing at all, while the union of the Director's and the Creator's tools is ~2.4k tokens
carried behind every request. Tools stay per-pass and land in the tail, where a differing
array costs nothing but itself.

**Keep the narration tail and append the pass brief after it.** Rejected: the narration
tail is addressed to the narrator — `instruct` literally says "write the next beat" — so
a pass's divergence from the narration payload would begin at the first of those blocks
rather than at its own brief, and the Director would be told to write prose.

**Let each pass keep its own small context and accept the miss.** Rejected: it is what
the app did, and it made the Director blind to the contract, cast and lore it was
keeping straight.

**Mode-neutral preamble plus mode in the tail.** This note's shape keeps the narration
contract in the head and subordinates it from the brief. Rewriting the frozen preamble to
be role-neutral would let more material sit in front of the divergence, but it also moves
the narrator's own voice rules out of the frozen prefix, and voice rules are the thing
the narrator most needs stated early. Not rejected forever — deferred until the shared
head is measured on more than one pass.

## Consequences

- The Director reads the whole story instead of the last twelve messages. That is more
  input tokens at 1/50th the price, and better material for its job; the private miss it
  used to pay was not small either.
- The head is now a *contract* two callers share, so a change to lore resolution or to
  the transcript trim moves both at once. That is the point — and `verify:store` pins it
  rather than trusting it.
- A turn whose own words trigger a new anchored lore entry re-prices the head for the
  narrator too. A pass inherits that; it does not add to it.
- The Summariser cannot use this shape: it compresses exactly the messages the history
  window drops, so its input sits *behind* the head. Sending it the head would hand it
  the wrong transcript and repeat the right one in its tail. It keeps its own call.
- The Creator cannot either: it is app-scoped and can run with no story open, so there is
  no story payload to ride.
- The route takes the scene the writer is looking at, because a pass must compose for the
  same scene the narration turn composes for. The server's own fallback is the *last*
  scene, and a story with a second, empty scene would otherwise compose a head with no
  transcript in it — and anchor its notes there.
- Narration itself is unchanged. It is the pass that *defines* the shared prefix, so the
  passes come to it rather than it being reshaped for them.
- The `director`, `archivist` and `conductor` toggles in the composer do reach the
  server: a turn with one switched on runs that pass after it writes, and the pass
  reports a receipt. See
  [the turn's opted-in passes run after it](../feature/2026-09-23-the-turns-opted-in-passes-run-after-it.md).

## Testing

`npm run verify:store` — a pass payload is a byte-prefix of the narration payload for the
same story, at the block level and at the level of the messages the API receives, before
and after the transcript window has been trimmed.

`npm run verify:cache` — the measured hit/miss split of a real Director call riding a real
narration turn, plus the notes that call produced, so a cache win that quietly made the
Director worse cannot pass unnoticed.
