# AGENTS.md

Working notes for anyone — human or agent — changing this codebase.

Reepi is a roleplay and writing studio whose entire architecture descends from one
external fact: **DeepSeek caches the prefix of a request on disk and re-reads it at
1/50th the price**, but only while the beginning of the payload stays byte-identical.
Everything here is downstream of that constraint. Read `README.md` for the cost model;
read this file before you move a file.

## Read this first

Two directories sit outside this file and will save you the most time:

- **`.agents/notes/`** — the reasoning this file cannot carry. Before changing anything
  structural, search it for the decision you are about to touch. It records *why this and
  not the obvious other alternative*, and several notes exist specifically to stop a
  plausible-looking "fix" that has already been measured and rejected. Start with
  [`.agents/notes/README.md`](.agents/notes/README.md); § 7 below states the rule for
  writing one.

There is no index to either, deliberately: both are meant to be explored, and a map is a
second source of truth that goes stale as the tree moves.

**A non-trivial change is not finished until it has an Agent Note.** § 7 defines
non-trivial and the format.

---

## 1. The one law

**A change to a prompt block invalidates that block and every block after it.**

Blocks are assembled in ascending `BLOCK_ORDER` (see `src/shared/types.ts`), sorted by
how often they churn. Frozen material (voice contract, genre, story bible, cast) sits
at the front and is paid for once. Volatile material (scene state, recalled memories,
the current turn) sits at the end and is cheap to change.

Before you touch anything that shapes the payload, ask which block you are editing and
what sits behind it. `payload.plan.blocks[].changed` and the `stablePrefixTokens` number
are the ground truth — the composer measures the real payload, it does not guess.

Two consequences that surprise people:

- **The transcript is one message, not N.** `composer.ts` collapses the whole history
  into a single user message so the front of the payload never moves. Do not "fix" this
  into a conventional message array; it would re-price the entire conversation on every
  turn.
- **Agents never write into the narration prefix.** Director, Archivist, Summariser and
  Conductor run as *separate* API calls (`src/server/agents/`). Inlining their output
  mid-transcript would invalidate the prefix they were meant to protect.

The fastest way to check yourself: `npm run verify:cache` drives the real composer
against the live API and prints predicted vs measured hit rate per turn.

---

## 2. Layout

```
src/shared/     pure types, cost model, token estimator, text helpers, API contract
src/server/     db, store, deepseek client, composer, agents, routes
src/web/        React UI — one store, many small components
scripts/        cache-verify.ts — the empirical check behind the central claim
```

### Barrels are the seam

A module with more than one job becomes a **directory plus a re-exporting barrel**:

```
src/server/store/index.ts        re-exports 13 DAO modules
src/server/routes/library.ts     re-exports library/{shared,sanitise,bundle,routes}
src/server/agents/index.ts       re-exports the five passes
src/web/store.ts                 re-exports store/{types,index}
src/web/components/modals.tsx    re-exports dialogs/*
```

Callers keep importing the original path, so a split never becomes a cross-cutting
edit. This is deliberate and it is the single most useful convention here — follow it
when you split something.

A barrel must stay a barrel. If you find yourself writing logic in one, it belongs in a
sibling module.

### The web store, specifically

`create<Store>()` may be called **exactly once** — a second call would give every consumer
a detached copy of the state. So `web/store/` is not several stores; it is one store
assembled from slices:

```
web/store/
  types.ts     the Store interface and the store's vocabulary
  slice.ts     the { get, set } seam, derived from zustand's own StateCreator
  runtime.ts   the shared mutable state — streamSeq, planTimer, activeController
  theme.ts     theme persistence (read pre-paint by index.html too)
  initial.ts   the initial state, as a function
  stream.ts    the StreamEvent reducer
  slices/      library, turns, messages, instruments, portability, getters
  index.ts     composes the slices into the one create() call
```

Two rules that keep this honest:

- **Slices never import each other.** When one action needs another it calls
  `get().thatAction()`. That is what makes the slices independent.
- **`runtime.ts` must stay the only home for `activeController`.** It is what makes
  `abort()` work; a per-slice copy would cancel nothing while the stream kept running
  invisibly.

### When to split

**Split for a second reason to change, not for a line count.** A number is a symptom;
treating it as a target produces files that are individually small and collectively
harder to follow. The tests, in order:

1. **Does this file have more than one reason to change?** `library.ts` was validation +
   story recreation + HTTP routes — three consumers, three change rates. That is the
   real case for splitting.
2. **Does it have two unrelated groups of callers?** `agents.ts` was five passes that
   never touched each other.
3. **Would a schema change and its reader land in one edit?** This is why `store/` has
   one file per entity: the row mapper sits beside the DAO that owns it.

Only then is size worth mentioning, and only as a *prompt to ask the three questions* —
not as an answer. Around 700 lines of cohesive logic is not a problem; `orchestrator.ts`
is that size and should stay that way.

**What not to do:** splitting one cohesive unit across files to satisfy a target, or
creating a module whose only content is a re-export of a single sibling. A file that
exists to satisfy symmetry is worse than a long file that reads straight through.

Splitting is mechanical and safe *if* you keep the barrel: every caller keeps importing
the original path, so the diff never touches call sites.

### Where things go

| Adding… | Put it in |
|---|---|
| A new prompt block | `shared/types.ts` (`BLOCK_ORDER`, label, volatility) + `server/composer.ts` |
| A new entity | `db.ts` DDL **and** `ADDITIVE_MIGRATIONS` + `server/store/<entity>.ts` + `routes/library/{sanitise,routes}.ts` |
| A new API endpoint | `routes/` + `shared/api.ts` + `web/api.ts` |
| A new HTML event shape | `shared/types.ts` (`StreamEvent`) + the turn slice in `web/store/` |
| A new agentic pass | `server/agents/<pass>.ts` + `agents/index.ts` + a `CostEventKind` + `routes/agentic.ts` |
| A new dialog | `web/components/dialogs/` + barrel export |
| A new panel control | `web/components/panel.tsx` |
| A new theme | `shared/types.ts` (`Theme`) + `web/theme.ts` + the four `html[data-theme]` blocks in `styles.css` |

---

## 3. Invariants that must not break

**Migrations are additive.** `CREATE TABLE IF NOT EXISTS` does nothing to an existing
table, so a column added to the DDL after a database exists would never appear and the
app would fail at runtime on a stale file. Every new column goes in **both** the DDL and
`ADDITIVE_MIGRATIONS` in `src/server/db.ts`. Additive only — an existing story database
must always survive an upgrade.

**Multi-row writes are atomic.** Ten tables change when a story is copied; six when a
turn is finalised. A partial write is unrecoverable, because nothing records what the
row set was *meant* to be. Wrap them in `transaction()` from `src/server/db.ts`:

```ts
return transaction(() => { /* all the writes */ });
```

`transaction()` is **not re-entrant** — `node:sqlite` has no nested transactions and a
nested call throws. Keep wrapped blocks flat.

**Patches are sanitised, never trusted.** Every request body goes through a
`sanitiseX()` before reaching a DAO. Without it, a JSON object where a string belongs
reaches `node:sqlite` and surfaces as a 500. A sanitiser returns `{ patch, rejected }`;
the route answers `400` naming the bad fields rather than silently dropping them.

**Every route guards existence first.** A `PATCH` against a deleted row must be a `404`,
never a silent no-op that the client reads as success.

**Server responses are the only source of money.** Cost and usage figures are computed
from the API's own accounting. The client may render optimistically, but it reconciles
against the returned row — see `patchMessage` in `web/store.ts`.

**The token estimator is calibrated, not exact.** Reepi does not ship DeepSeek's BPE
vocabulary. `tokens.ts` folds each response's true `prompt_tokens` back in as an EWMA
correction stored in `settings`. Predictions therefore converge over a few turns and run
slightly pessimistic. Do not present an estimate as exact.

---

## 4. Conventions

**Comments explain why, not what.** State the constraint that forced the code. The
existing comments are the register to match — e.g. `// A cache unit needs a moment to
persist before the next request can hit it.` Not `// sleep 3 seconds`.

**No duplicated helper.** If two modules need the same thing, it moves to a shared
module. Real examples that were fixed: `SectionTitle` and `Metric` →
`web/components/panel.tsx`; the theme swatch tables → `web/theme.ts`; `slug` →
`shared/text.ts`; the memory/note kind lists → `shared/types.ts`, with the union types
*derived* from them (`type MemoryKind = (typeof MEMORY_KINDS)[number]`) so a new kind
cannot exist in one place and not the others.

**`shared/` must stay browser-safe.** No `node:` imports in anything the web bundle
reaches. `shared/ids.ts` needs `node:crypto`; that is exactly why `text.ts` exists
separately. This constraint is not cosmetic — a wrong import here has already caused one
helper to silently fork into two divergent copies.

**Types are the contract.** `shared/` owns them. A type that exists in two places will
diverge.

**Prefer boring.** No new dependency for something thirty lines of standard library
covers. The whole runtime is Hono, React, zustand and Node's built-in SQLite.

---

## 5. Verify your work

```bash
npx tsc --noEmit          # strict; must exit 0
npx vite build            # must succeed
npm run verify:cache      # only if you touched the composer, blocks, or agents
```

**Compiling is not running.** A refactor has passed neither bar until the server has
booted. A module can typecheck cleanly and still crash at import time — for example if a
moved function was never given the `export` keyword its new caller now needs. That
failure only appears when the module graph is instantiated, so start the server and
exercise a route. This has already happened once here.

For a UI change, look at the actual surface — the app must render, not just compile.
For a behavioural change, exercise the real path and state what you observed.

`verify:cache` spends real credit (a fraction of a cent). Use it when you have changed
the payload; it is the only thing that proves the cache discipline still holds.

Three proofs exist and are cheap to re-run after a structural change:

| Command | What it proves |
|---|---|
| `npm run verify:cache` | the payload discipline survives (hit rate, prediction drift) |
| `npm run verify:store` | every DAO still round-trips, and cascade deletes work |
| `npm run verify:tx` | rollback discards all writes; nesting fails loudly |

`verify:store` and `verify:tx` are free and take seconds. Run both after any change to
`db.ts`, `store/`, or the bundle recreation path. `verify:cache` spends a fraction of a
cent and is the only one that needs an API key.

---

## 6. Traps

Things that have already cost time in this codebase.

- **Check before you "fix".** Two apparent bugs during the last refactor were not bugs:
  the export route takes `format=markdown` while the import route takes `format=text`
  (different operations, different vocabularies), and `recall` returning zero hits simply
  meant the query used words absent from the stored memories. Verify the contract before
  changing working code.
- **Compiling ≠ running.** A split can typecheck green and crash on boot if a moved
  symbol lacks its `export`. Always start the server after a structural change.
- **Exports used only in their own file should be private**, but exports read by
  *sibling modules in the same directory* must stay exported. Widening exports to make a
  split compile is correct; do it in the module that owns the helper.
- **Emptying a `changed` set is not "no change".** The composer compares against the last
  request that got a cache hit, not the last request sent.
- **`sed` across the tree will corrupt imports.** `store.ts` exists in *both* `src/server/`
  (now a directory) and `src/web/` (a plain file). Scope replacements to one directory.
- **Bun resolves `./store` to a directory; TypeScript needs `./store/index.ts`.** Write
  directory specifiers explicitly.
- **A generated rewrite can double-apply a modifier.** A script that prepends `export`
  will also match lines that already have it, producing `export export`. Anchor such
  patterns or verify afterwards.
- **`node:sqlite` needs `PRAGMA foreign_keys = ON`** for cascade deletes; it is set in the
  DDL. A test that deletes a story and still finds its messages has found a real bug.
- **Assigning `speaker` on a turn is what gives it a portrait.** An assistant turn with
  no `speaker` renders as "Narrator" with initials, which is correct but often not what
  was meant.
- **Peak pricing is 2×** and excludes Chinese public holidays, which are not enumerable
  here — so cost readouts slightly over-estimate on those days. Known and documented.
- **Do not run `git` commands to "verify" an edit.** The tool result is the verification.

---

## 7. Agent Notes

`.agents/notes/` holds the reasoning that code and this file cannot carry: which alternative
lost, which mistake must not be repeated, which boundary is deliberate. **Code says what
happens. This file says how to work. An Agent Note says why this and not the obvious other
thing** — the only question a future reader cannot answer from the source.

**Every non-trivial change adds or updates at least one note in the same change.** Non-trivial
means it alters behaviour, architecture, a shared contract, process, testing strategy, an
on-disk or wire format, or any decision a maintainer might revisit. Purely mechanical edits —
a typo, a local rename, a colour token — are exempt.

Updating the note that already owns a decision satisfies the rule. **Do not create a
duplicate.** A note is never edited into a *different* decision; supersede it and cross-link
both. The one permitted edit is factual drift: when code moves a file or changes a default, the
note is updated in the same change to match.

Layout is `{lifecycle}/{class}/yyyy-mm-dd-topic.md`. Lifecycles: `proposed`, `implemented`,
`rejected`, `archived`. Classes: `feature`, `bug-fix`, `simplification`, `architecture`,
`process`, `testing`. Read [`.agents/notes/README.md`](.agents/notes/README.md) for the format.

**There is no index, deliberately.** Search the corpus for the mechanism you are about to
change — by what it does, not by its title, since a note about the payload cache may be filed
under `architecture` and named for something else entirely. An index would be a second source
of truth that drifts as the tree moves, and the corpus is small enough to read. Read widely;
a note adjacent to the one you were looking for is often the more useful find.

Three rules that matter more than the rest:

- **`## Alternatives considered` is mandatory.** A decision recorded without what it beat
  invites being undone. The strongest notes in this corpus are the *rejections*, because they
  are falsifiable: the note on reverting the module split does not argue from taste, it records
  that a specific claim was measured and came back wrong.
- **Write down your own errors.** Two rejections here came from mistakes made during
  development rather than from decisions. Both were kept deliberately — an error is what a
  future reader is most likely to repeat.
- **Never archive toward a quota, and never judge by word count.** A 200-word note about a
  foundational boundary outlives a 2,000-word note about finished UI work. The question is
  whether the reasoning still has force.

```bash
npm run verify:notes     # format, folder agreement, sections, links — instant, no key
```

Procedures for this repository live in `.agents/skills/`, one directory per skill with its
own `SKILL.md`. Most relevant to this section is `reepi-agent-notes`, which covers the
judgement calls the format cannot make — supersession, archiving, deletion.

---
