# Reepi

A chat studio for **roleplay and creative writing**, built on DeepSeek — and built
around one obsession: **making the prompt cache hit.**

Reepi is not a coding assistant. It is a place to write: long-form fiction,
character-driven roleplay, collaborative scenes. It just happens to be
instrumented like a trading desk.

![status](https://img.shields.io/badge/status-working-brightgreen)

---

## Why cache-hits are the whole product

DeepSeek prices input tokens two ways, and the gap is not small:

| | `deepseek-flash` off-peak | `deepseek-flash` peak | `deepseek-v4-pro` off-peak |
|---|---|---|---|
| **Input — cache hit** | $0.003 / 1M | $0.006 / 1M | $0.022 / 1M |
| **Input — cache miss** | $0.15 / 1M | $0.30 / 1M | $0.66 / 1M |
| **Output** | $0.60 / 1M | $1.20 / 1M | $1.98 / 1M |

A cache **hit costs 1/50th of a miss** on flash. On v4-pro at peak, a miss costs
**440×** a flash hit.

For a roleplayer this is the single largest lever that exists. A long scene has a
large fixed payload — contract, story bible, cast cards, world lore — that barely
changes from turn to turn. That fixed part is exactly what the cache can serve.
Getting it right turns the dominant cost of a session into a rounding error;
getting it wrong means paying full price for the same 20,000 tokens on every
single turn.

So the app treats cache behaviour as a first-class, visible, measurable thing
rather than an implementation detail.

---

## The mechanism, and how Reepi exploits it

DeepSeek's context caching is automatic and on by default, but the rules are
specific ([docs](https://api-docs.deepseek.com/guides/kv_cache)):

- A cache **prefix unit** is persisted at every *request boundary*.
- A hit requires a **full** match against such a unit. Nothing is partial.
- Units are also carved at fixed token intervals for long inputs.
- Construction takes seconds; cache is best-effort and expires after hours-to-days
  of disuse.

"Full match, from the very first byte" is the constraint everything bends around.
One changed character at the front and the entire payload is a miss.

### 1. Blocks, ordered by volatility

The payload is assembled from named blocks and sorted so that **frozen content
comes first and volatile content comes last**. A change to a block invalidates that
block and everything after it — never anything before it.

```
┌─ system ── Voice & format contract ─── volatility 0 (frozen)   ┐
│            Genre & tone ────────────── 0                        │  ← cacheable
│            Prose style ─────────────── 0                        │    prefix
│            Story bible ─────────────── 1                        │
│            Scenario ────────────────── 1                        │
│            Style exemplars ─────────── 1                        │
├─ system ── Cast cards ──────────────── 2                        ┤
│            Player persona ──────────── 2                        │
│            Anchored lore ───────────── 2                        │
├─ user ──── Transcript (ONE message) ── 3                        ┤
├─ system ── Depth lore ──────────────── 3                        ┤
│            Scene state ─────────────── 3                        │  ← volatile
│            Director briefing ───────── 3                        │    tail
│            Recalled memories ───────── 3                        │
│            Lore (before/after) ─────── 3                        │
│            Author note ─────────────── 3                        │
│            Instruction ─────────────── 3                        │
├─ user ──── Your turn ───────────────── 3                        ┤
└─ assistant (optional prefill, `prefix: true`)                   ┘
```

The scene state, director's notes, recalled memories and author note **churn every
single turn** — and that costs nothing, because they sit at the very end. Only
touching the story bible invalidates the expensive prefix in front of them.

### 2. The transcript is one message, not N messages

This is the highest-leverage decision in the codebase.

The obvious implementation renders history as `system, user, assistant, user,
assistant, …`. But a cache unit is persisted at the *end of the model output*
boundary — so that layout only ever matches up to the previous turn's end, and the
fixed region at the front is re-sent as a miss whenever anything moves.

Collapsing the whole transcript into **one user message** keeps the front of the
payload byte-stable across an arbitrarily long conversation: blocks 1–3 match, and
only the growing transcript block differs.

Measured with `npm run verify:cache`, which drives the real composer against the
live API:

```
=== turn 2 ===
payload            1992 tok in 5 messages, 10 blocks
stable prefix      1825 tok  (predicted hit 91.6%)
ACTUAL usage       1920 hit / 253 miss  = 88.4%   drift -3.3pt
cost               $0.00012   (cold: $0.00041, saved $0.00028)
ttft 687ms

=== turn 3 ===
payload            2127 tok in 5 messages, 10 blocks
stable prefix      1963 tok  (predicted hit 92.3%)
ACTUAL usage       2048 hit / 282 miss  = 87.9%   drift -4.4pt
cost               $0.00013   (cold: $0.00043, saved $0.00030)
```

**~88% of input tokens served from cache, cost cut by ~70%, prediction drift
under 5 points.** A separate probe on a repeated 10k-token prefix measured
**98.6% hit with a 1.8× faster second call**. A 27-message scene reduces to a
5-message payload.

The meter's one honest caveat: it previews the payload for the turn you *have not
sent yet*. Once the transcript grows to dominate the payload, the measured rate
runs ahead of the prediction until you send, because the preview cannot know what
you are about to add. The UI states this difference explicitly rather than hiding
it.

### 3. Trim hysteresis

The transcript block sits mid-payload, so any change to it invalidates itself and
everything after. Dropping one message at a time would therefore churn the payload
on *every* turn — the failure mode is invisible but expensive.

Instead, budget overrun drops a whole slab at once, down to an 82% low-water mark,
and the window then stays **byte-identical** for many turns. Verified: **25 of 26
consecutive turns kept an identical window**; the trim fired once.

### 4. Agents run side-channel, never inline

The tempting design is to give the narrator tools — a director that can update
scene state mid-generation. Reepi deliberately does not.

Reason: **thinking mode is ON by default on V4.1 Flash at effort `high`**, and
thinking mode *silently ignores `temperature`*. Temperature is not a nicety for
creative writing, it is the dial that makes prose alive. Worse, any request
carrying `tools` forces DeepSeek to require the full `reasoning_content` echoed
back on every subsequent turn — reasoning tokens are billed as input, cannot be
cached away, and grow the payload forever.

So narration runs with:

```ts
reasoning_effort: 'none'   // the only value that DISABLES thinking
// no `tools`               // prefix stays clean and temperature is honoured
```

and the agentic work happens in **separate contexts**:

| Pass | Job | Why separate is cheaper |
|---|---|---|
| **Director** | Continuity, scene state, thread tracking, craft notes | Produces a small durable artefact reused across turns — instead of re-deriving continuity inside all of them |
| **Archivist** | Extracts durable facts into a memory index | Paid once per scene, not per turn |
| **Summariser** | Compresses trimmed history into a rolling synopsis | Recovers what the history budget dropped, once |
| **Conductor** | Drafts N continuations, a cheap judge picks one | See below |
| **Creation assistant** | Writes characters, lorebooks, directive blocks, templates and whole stories from a request | Produces world material as ordinary rows — the same tables the studio's own editors write — and its tools are a side-channel call, so the prefix it re-prices is the content's, never the payload's |

### 5. The Conductor: N drafts for barely more than one

Drafting several continuations normally multiplies input cost by N. Because cache
hits cost 1/50th of a miss, Reepi sends **byte-identical payloads** and varies
*only* temperature:

```
variant 1  →  full price (miss)   ← also persists the cache unit
variant 2  →  1/50th price (hit)
variant 3  →  1/50th price (hit)
```

Input cost is `1 × miss + (N-1) × hit`, not `N × miss`. Three drafts cost roughly
**1.04× the input of one**, plus the output tokens that are genuinely unavoidable.
A cheap judge — itself a cache-friendly short call — then picks the best.

Variants run **sequentially**, not in parallel: a cache unit only becomes servable
once the first request has persisted it. Racing them would make every variant pay
the miss price, defeating the entire trick.

### 6. Peak / off-peak scheduling

Peak hours (01:00–04:00 and 06:00–10:00 UTC, Mon–Fri) bill at exactly **2×**.
Reepi shows a live countdown to the half-price window and tells you when deferring
a long session would halve the bill.

### 7. Memory recall that costs nothing

Recall is local BM25 over SQLite **FTS5** — in-process, zero API cost, zero
latency, no embedding round-trip. The query terms are extracted from the recent
transcript, ranked by `bm25()` blended with recency and stored salience, then
filtered so weak matches never reach the payload. API-based semantic recall is
strictly an optional upgrade, not a prerequisite.

---

## What the writer gets

**The interface is a chat, and the instrumentation is behind it.** A transcript of
bubbles — portrait, name, prose — with the writer's turns aligned right in the
accent and the story's turns aligned left. Dialogue is the loudest ink on the page,
because in roleplay dialogue is the point. Every number the app computes is one
click away and none of it is on the default screen.

- **Characters and personas are yours to build** on a **Cast page** — a roster you scan,
  search, filter and sort, one card each with its weight in the prefix. It opens from the
  studio list in the library rail (and the phone's menu), so building a cast does not begin
  in the payload inspector. Each card has a full editor: portrait, name, tagline,
  description, personality, speech habits, scenario and example dialogue, with portraits
  shown beside every turn the character speaks.
- **A character is a library object, not a story's property.** The page has two scopes:
  **This story** is the payload roster, totalled in tokens; **Library** is every character you
  have written, grouped by the story it came from. Any story can **add an existing character to
  its cast** — a blank story is not a dead end — and that is a reference, not a copy, so editing
  a card edits it in every story that casts it. Deleting a story keeps its characters and their
  conversations: the cards outlive it, and a chat keeps the persona it was using. Personas stay
  story-scoped, because "who am I here" is a question about the story.
- **Click a character and you are talking to them.** A card's face opens a 1:1 chat — created
  on first use, reopened after that — and that chat is a real conversation: one borrowed card,
  its own transcript, its own cache prefix and cost. It inherits the story's world (contract,
  genre, style, bible, scenario and anchored lore) and none of its turns, and it opens on the
  card's greeting. Who you are is a chip beside the composer, switchable mid-chat; switching
  re-prices the payload from the persona block on, which is the one cache cost the interface
  states before you take it. The pencil in the card's footer is still the editor.
- **A creation assistant with its own chat.** A **Creation assistant** row sits above your stories
  in the library rail — it is a conversation you come back to, not a dialog you summon from inside a
  story, and it is reachable before you have a story at all. Ask it in plain language — "file a
  lorebook about the drowned archive", "write two characters for the court", "start a story from
  this pitch" — and it writes into the app with real tools: character cards, lorebook entries with
  trigger keys, the scenario, story bible, genre, style, contract and instruction blocks, reusable
  prompt templates, and whole new stories complete with an opening scene, a persona and a cast. Two
  controls keep it honest: **Write into** names the story a turn may touch (or *No story*, where
  characters become library cards any story can adopt later), and **Allow rewriting** is off by
  default so a directive block that already has text is never quietly replaced. Because what it
  writes *is* the frozen prefix, every turn reports what it made, what it revised, what it refused
  and which blocks moved (measured: one card added re-priced the cast block and everything behind it
  and nothing before it, at 0.671 → 0.573 predicted hit rate). Both controls sit beside the
  composer, because they describe the message being sent rather than a form to fill in first. The
  conversation is stored, so a reload lands you back in it with every receipt intact; **Stop** ends
  a turn without recording anything, **New chat** clears the conversation and deletes none of the
  content. It never writes prose, dialogue or your persona, and it cannot delete anything.
- **Prompt templates and macros.** The blocks you author — voice contract, genre, style, bible,
  scenario, exemplars, instruction — can be saved as named templates and applied to any story in
  one action, singly or several at once. Every block accepts `{{macros}}` (`{{char}}`, `{{user}}`,
  `{{description}}`, `{{persona}}`, `{{scenario}}`, `{{state}}`, `{{targetWords}}` and thirteen
  more) which resolve against the story **on every turn**, never baked in: a template that says
  `{{user}}` stays correct when the persona changes. The library lives in a studio row and the
  command palette, with a reference panel that shows each macro's live value for the open story.
  Five starters ship read-only; duplicating one gives you an editable copy. The agentic passes and
  their tool schemas are deliberately *not* templatable — this is the writer's system prompt, not
  the machinery.
- **Attribution.** Any turn can be reassigned to a character, so an ensemble scene
  reads as a conversation between named speakers rather than a wall of "Narrator".
- **One cost pill** in the composer — live predicted hit rate, the price of the
  turn, and what the cache took off it. Tap it for the full payload analysis.
- **A foldable turn-details disclosure** per message: hit rate, hit/miss tokens,
  output, cost, saved-vs-cold, time-to-first-token, whether it was billed at peak,
  and which lore entries were injected.
- **Conversation-aware advice** — the app reads its own ledger and names the frozen
  block you have been editing if your realised hit rate slips.
- **A payload inspector** behind one button (collapsed by default, and the choice
  is remembered): every block, its token share, volatility class, whether it
  changed, and its rendered text.
- **Warm-up** — pays one miss-priced pass deliberately after editing canon, then
  *proves* it worked by re-sending the identical payload and reading the API's own
  hit accounting.
- **Live diagnosis** — repeats a ~4k-token payload and reports the measured hit
  rate, so the app's central assumption is verified against reality.
- **A cost ledger**, on demand — realised hit rate, total saved vs a naive client,
  the 50× cache multiplier, cost per 1k words, and projections.
- **Four themes** (`ink`, `ember`, `verdant`, `daylight`), literary typography, and
  a layout verified free of horizontal overflow from 320px to 1920px.

The craft features a roleplayer expects are all present: swipes (variants) with
arbitrary history, redo/continue/impersonate, editable messages, pinning and
excluding turns, branching a story at any point, per-turn sampling overrides,
SillyTavern v2 character-card import/export, JSON bundles, Markdown export, and a
director's notebook.

---

## Running it

Development is two processes, in two terminals:

```bash
npm install
cp .env.example .env        # add your DEEPSEEK_API_KEY
npm run dev                 # the API on :8787 (it also serves the last build, if any)
npm run dev:web             # the live UI on :5273, proxying /api to :8787
```

Open <http://127.0.0.1:5273>. That is the UI with hot reload; `:8787` is the API,
and it serves whatever `dist/` last held — which is why the server warns at boot
when `dist/` is older than `src/`.

Production is one process:

```bash
npm run serve               # builds the SPA, then serves it from the API on :8787
```

Or build once and serve the build without rebuilding: `npm run build && npm start`.

`npm run typecheck` runs `tsc --noEmit`.

### Verification

Three checks exist, each proving one thing that is easy to break silently:

```bash
npm run verify:cache   # the payload discipline survives — needs an API key
npm run verify:store   # every DAO round-trips; cascade deletes work — free
npm run verify:tx      # rollback discards all writes — free
```

`verify:cache` is the empirical check behind the central claim. It drives the real
composer against the live API in a throwaway database and prints, per turn, the predicted
hit rate next to the API's own measured one. A three-turn run costs a few tenths of a cent
on `deepseek-flash` off-peak.

`npm run verify:store` and `npm run verify:tx` are instant and need no key. Run both after touching
`db.ts`, `store/`, or the bundle recreation path — they cover the two invariants that a
refactor is most likely to break quietly.

`npm run verify:notes` checks the Agent Note corpus in `.agents/notes/`: the lifecycle and
class tree, the header block, required sections per lifecycle, inter-note links, and duplicate
titles. Also instant and free.

### Agent Notes

`AGENTS.md` says how to work; the code says what happens. `.agents/notes/` carries the third
thing — **why this and not the obvious other alternative**, which is the one question a reader
cannot answer from the source.

Notes are filed by lifecycle (`proposed`, `implemented`, `rejected`, `archived`) and class
(`feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`). Every note
carries an `## Alternatives considered` section, because a decision recorded without what it
beat invites being undone.

The most useful entries are the rejections. Two decisions were considered and declined with the
reasoning recorded: reverting the module split — where the objection was real, was measured, and
the measurement contradicted it — and the mechanical line-count split rule. Two small
consolidations remain open as proposals. Eight implemented notes cover the load-bearing
decisions: the collapsed transcript, narration carrying no tools, atomic multi-row writes,
recognising a changed block by identity, one definition per helper, and the four verification
mechanisms.

Read [`.agents/notes/README.md`](.agents/notes/README.md) for the format.


### Stack

React 19 · Vite 6 · Tailwind v4 · Zustand · Hono · `node:sqlite` · TypeScript

Zero native dependencies: the database is Node's built-in `node:sqlite` (FTS5
included), and the server runs TypeScript directly via Node 24 type stripping —
no build step for the backend.

> **Changing the code?** Read [`AGENTS.md`](AGENTS.md) first. It covers the one law that
> governs the payload order, the invariants that must not break (additive migrations,
> atomic multi-row writes, sanitised patches), and the conventions this codebase follows.


---

## API

```
POST /api/plan                  → PayloadPlan          dry run, zero spend
POST /api/chat                  → text/event-stream    narration
POST /api/stories/:id/warm      → WarmupResult         warm + verify the prefix
POST /api/stories/:id/director  → DirectorResult
POST /api/stories/:id/archivist → ArchivistResult
POST /api/stories/:id/summarise → SummaryResult
POST /api/stories/:id/conductor → ConductorResult      N drafts, one judge
GET  /api/creator/messages      → CreatorMessage[]     the assistant's own stored conversation
POST /api/creator               → CreatorResponse      one turn: builds characters, lore, blocks, stories
DELETE /api/creator/messages    → { ok }               new chat: the conversation goes, the content stays
POST /api/characters/:id/chat   → Story                open or start their 1:1 chat
GET  /api/characters            → CastIndex            every card, plus every cast membership
POST /api/stories/:id/cast      → Character[]          adopt an existing card into a cast
DELETE /api/stories/:id/cast/:characterId → { ok }     take it out, without deleting it
GET  /api/templates             → PromptTemplate[]     built-ins first, then yours
POST /api/templates             → PromptTemplate
GET  /api/macros?storyId=       → MacroInfo[]          each macro's live value
GET  /api/stories/:id/insights  → Insights
GET  /api/diagnose              → DiagnoseReport       live cache verification
GET  /api/stories/:id/export?format=json|chara|markdown
POST /api/import                → Story
```

Plus full CRUD for stories, scenes, characters, personas, lore, memories, threads,
notes, messages and prompt templates (built-ins answer `409`, never a silent no-op).
See `src/shared/api.ts` for the frozen contract.

---

## Layout

Modules are split by responsibility, and anything with more than one job is a directory
behind a re-exporting barrel — so a split never forces an edit at the call site.

```
src/
  shared/          pure types, cost model, token estimator, text helpers, API contract
    types.ts         domain types + the block order, volatility table, kind lists,
                     the editable-block table, the block-to-field mapper
    macros.ts        the macro registry: names, labels, groups, hints, the token pattern
    cost.ts          pricing, peak/off-peak, the 50x cache multiplier
    tokens.ts        estimator + self-calibrating EWMA correction
    text.ts          browser-safe string helpers (no node: imports)
  server/
    db.ts            schema, additive migrations, transaction()
    store/           the DAO modules behind index.ts — mapper lives beside its DAO
    deepseek.ts      SSE client, usage/cache accounting, retries
    composer.ts      the block-ordered, cache-stable payload builder; expands macros
    macros.ts        what each macro means for a story, and the reference read model
    render.ts        cast / scene-state / thread renderers, shared by composer and macros
    templates.ts     the code-shipped starter templates (merged in, never seeded)
    chats.ts         starting a character chat: the world it copies, the card it borrows,
                     and the persona it freezes when that world is deleted
    lorebook.ts      keyword scan, budget packing, BM25 + term extraction
    orchestrator.ts  turn engine, trim hysteresis, calibration, ledger
    agents/          director / archivist / summariser / conductor / diagnose / creator
    routes/
      library/       shared validation, sanitise, bundle recreation, routes
      chat.ts        plan (dry run) + chat (streamed SSE)
      templates.ts   prompt-template CRUD + the macro reference
      agentic.ts     director, archivist, summarise, conductor, judge, warm
      creator.ts     the assistant's own conversation, and one turn of it
      memory.ts      memories, recall
      portability.ts export/import: JSON, markdown, chara v2 PNG
      insights.ts    the cost ledger read model
  web/
    App.tsx          shell: centre column routing (transcript or a page), rails
    store.ts         barrel over store/ — one zustand store, assembled from slices
    store/
      types.ts       the Store interface and the store's vocabulary
      runtime.ts     shared mutable state: streamSeq, planTimer, activeController
      stream.ts      the StreamEvent reducer
      slices/        library, turns, messages, instruments, portability, templates, creator, getters
    speakers.ts      resolves a turn's speaker and portrait against the cast
    theme.ts         theme labels and swatch gradients, one definition
    api.ts           typed client + SSE frame reader
    components/
      Library.tsx        the conversation list, its day filing, and the assistant's own row
      CastPage.tsx       the cast roster, this story's and the library's, and the way into a chat
      CreatorPage.tsx    the assistant's own chat: target, receipt per turn, and the prefix it moved
      Sidebar.tsx        the library rail: band, list, scenes, studio theme
      StudioNav.tsx      cast / assistant / cost / settings / transfer / duplicate, one list for both hosts
      StoryActions.tsx   a story row's overflow menu, viewport-anchored
      Transcript.tsx     the chat feed, scroll-stick policy, streaming states
      MessageBubble.tsx  avatar + name + bubble, aligned per speaker
      MessageActions.tsx swipe/regenerate/edit/pin/exclude/branch/attribute
      Composer.tsx       writing surface, the compact cost pill, and who you are writing as
      PersonaSwitch.tsx  the composer's persona chip: who the model reads as you, switchable
      MacroPicker.tsx    the macro reference (live values) and the insert-a-token control
      CacheMeter.tsx     the pill, and the full payload meter behind it
      Inspector.tsx      rail chrome: the band, the menu, the open section
      panel.tsx          SectionTitle / Card / Metric / PageBand, shared by every panel and page
      editors.tsx        cost ledger + full character/persona editors
      MobileBar.tsx      app header and the navigation sheet
      modals.tsx         barrel over dialogs/
      dialogs/           one module per dialog: story settings, prompt templates, transfer…
```

Files are split when they have more than one reason to change — not to hit a line
count. `orchestrator.ts` at ~700 lines is cohesive and stays that way; the three files
that were over 1100 lines each held unrelated jobs and were split.

## Notes and honest limits

- **Token counts in previews are estimated**, not tokenised — Reepi does not ship
  DeepSeek's BPE vocabulary. The estimator is self-calibrating: every response's
  true `prompt_tokens` is folded back in as an EWMA correction, so previews
  converge on reality within a few turns. Measured predictions land within a few
  points of actual, always slightly pessimistic.
- **Peak windows exclude Chinese public holidays**, which are not enumerable here
  and so are not modelled. Cost readouts are therefore a slight over-estimate on
  those days.
- **Cache hits are best-effort on DeepSeek's side.** Near-90% is what this
  architecture achieves, not 100% — a very long-running server can see cache
  units expire mid-session.
- **A macro inside a frozen block is a cache decision.** Text that reads a live
  value sits at the front of the payload, so changing that value (a persona switch, an
  edited card) re-prices everything behind it. The composer names the macro and the
  block in its warnings, and Story settings says so before you apply a template.
- **Prompt templates are app-scoped, not part of a story export.** A JSON bundle
  carries the story, never the library; a fresh database starts with the built-ins.
- Chat prefix completion uses DeepSeek's `/beta` base URL and is marked beta
  upstream.
- Costs shown are estimates derived from the published rate card; the
  authoritative figure is always your DeepSeek dashboard.
