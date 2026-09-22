# AGENTS.md

Hello, I am Ignacio and you are my agent, we are working together in this project, particularly centered around an AI Chat Platform with Roleplay capabilities.

I believe in you and the work that you do, and how you do things. So if I believe in you, you should also believe in yourself and your capabilities.

---

## Durable Agent Notes (`.agents/notes/`)

The repository uses `.agents/notes/` as a durable, growing history of *why* decisions were made. A note is not a changelog: it records the problem, the decision, the alternatives that were rejected, and the consequences — the rationale that code alone cannot carry.

### When to write or update a note

Every non-trivial change should add or update at least one Agent Note in the same commit/PR. A change is non-trivial when it alters:

- Behavior, architecture, or a contract shared across files/packages
- Process, tooling, migration strategy, or testing strategy
- On-disk, wire, configuration, or API formats
- A decision a maintainer may reasonably revisit
- A decision to **reject or archive** a feature/proposal (recording *why* it was turned down)

Pure mechanical/local edits with no behavior or rationale change are exempt. Updating the note that already owns the decision is preferred over creating a duplicate.

### Layout

```
.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic-title.md
```

- **Lifecycle** (top-level folder):
  - `proposed/` — under consideration, not yet built. (`Status: proposed`)
  - `implemented/` — shipped to master. (`Status: implemented`)
  - `rejected/` — evaluated and declined. Records the problem, why it was rejected, and what trade-offs drove the decision. (`Status: rejected`)
  - `archived/` — superseded notes kept for historical context. (`Status: archived`)

- **Class** (nested folder):
  - `architecture` — structural decisions about source code and services.
  - `simplification` — removed code, dead surface, or reduced complexity.
  - `bug-fix` — defect correction or closed gaps.
  - `process` — tooling, workflow, or repository policies.
  - `testing` — test infrastructure and strategies.
  - `feature` — user- or model-facing capabilities and feature scope decisions.

The `Status:` line inside each note must strictly match its lifecycle folder:
- `Status: proposed` inside `proposed/`
- `Status: implemented` inside `implemented/`
- `Status: rejected` inside `rejected/`
- `Status: archived` inside `archived/`

### File format

```markdown
# Agent Note: <title>

Status: <proposed | implemented | rejected | archived>

## Problem

## Decision

## Alternatives considered

## Consequences
```

- `## Problem` — the motivation or user need, written to stand standalone.
- `## Decision` — what shipped (present tense for implemented), what is proposed, or why a path was rejected.
- `## Alternatives considered` — each genuine alternative and why it was declined or deferred.
- `## Consequences` — the trade-off: what it bought and what it cost.
- Optional `## Testing` for the verification suite that pins the decision.

### Rules for keeping notes healthy

1. **Add before/with the change.** A proposal for substantial future work goes in `proposed/`; a decision already made starts in `implemented/`; a decision to reject a proposal goes in `rejected/`.
2. **Keep implemented notes current.** When code moves a file, renames a symbol, changes a default, or alters a mechanism, update the corresponding implemented note in the same change — facts only.
3. **Never rewrite a decision into a different one.** A reversal requires a new note; keep both cross-linked unless the old one is fully superseded.
4. **Check for supersession.** Before adding a new note, search `.agents/notes/` for an older note covering the same decision/mechanism. Update it, or cross-link the new note to it.
5. **Use relative markdown links** between notes so they survive moves between lifecycle folders.
6. **No automated gate yet.** There are no verification scripts in this repo for notes, so humans and agents are responsible for consistency. Follow `.agents/notes/README.md` as the source of truth.

---

## Suggestions Lifecycle (`suggestions/`)

The repository organizes feature roadmaps and suggestions under `suggestions/`:

- `suggestions/` (root) — open, active suggestions under exploration (e.g. `007`, `010`).
- `suggestions/completed/` — suggestions that have been fully built and shipped (e.g. `001`, `002`, `003`, `005`).
- `suggestions/archived/` — suggestions that were rejected, out-of-scope, or superseded (e.g. `004`, `006`, `008`, `009`).

### Protocol when a suggestion is resolved or rejected

Whenever a suggestion status changes:
1. Move the suggestion file into either `suggestions/completed/` or `suggestions/archived/`.
2. Update the suggestion document header with its status and rationale (e.g. `Status: 🔒 Rejected / Superseded`).
3. Update `suggestions/README.md` and `docs/pending-work.md` with updated relative links and status badges.
4. Record an Agent Note in `.agents/notes/implemented/` (if shipped) or `.agents/notes/rejected/` (if declined).

---

## Documentation

Keep the app documentation in sync with reality. When a change affects the project landscape, update the relevant docs in the same commit:

If a change updates architecture/codebase/database facts, record *why* in `.agents/notes/` as well — the docs describe what is true, the notes describe why it is true.

---

## Finishing a task

Before reporting completion:

1. Run the relevant checks.
2. Verify the working tree contains the intended files only (`git status`).
3. Confirm any non-trivial change has an Agent Note (implemented or rejected) and updated docs/suggestions.
4. Commit with a clear message and push when the user expects it.
