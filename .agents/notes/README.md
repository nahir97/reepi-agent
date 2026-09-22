# Agent Notes

One kind of design document lives here. An **Agent Note** records a decision that shapes
this codebase — the *why*, and **what we gave up**. It carries the reasoning that code and
the README cannot: the alternative that lost, the constraint that forced the shape, the
mistake that must not be repeated.

Code says what happens. `AGENTS.md` says how to work. An Agent Note says *why this and not
the obvious other thing*, and that is the only question a future reader cannot answer from
the source.

## Why this exists

Reepi accumulates decisions that look arbitrary from the inside. Why is the transcript one
message instead of an array? Why does narration carry no tools? Why is `store/` one file per
entity? Each of those is defensible and each is *reversible by a confident stranger who has
not read the reasoning*. The failure mode is not a bad decision — it is a good decision
re-litigated six months later by someone who then "fixes" it.

An Agent Note is the artefact that stops that. It is why every note carries an
`## Alternatives considered` section: **a decision recorded without what it beat invites
being undone.**

The strongest entries in this corpus are the rejections. A rejected note on reverting the
module split exists precisely because that idea already came up once, looked reasonable, and
was measured and declined — with the numbers.

## Layout and naming

Every note has two axes, both encoded in its **path**:
`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`.

**Lifecycle** is the top-level folder, and a note moves between folders as its status
changes:

| Folder | Meaning |
|---|---|
| `proposed/` | Designed and reviewed, not yet built. Plans and open questions belong here. |
| `implemented/` | The decision shipped. Written in the present tense and **kept current with what actually shipped**. |
| `rejected/` | Considered and declined. Kept only while it prevents a tempting mistake. |
| `archived/` | An implemented note whose rationale no longer guides work. Frozen; never edited. |

**Class** is the kind of decision:

| Class | Covers |
|---|---|
| `feature` | A new user-facing capability. |
| `bug-fix` | Corrects a defect, or closes a gap a failure surfaced. |
| `simplification` | Removes code, behaviour or surface area without adding capability. |
| `architecture` | A structural decision about the shipped source — how modules relate, what the vocabulary is. |
| `process` | Tooling, policy or workflow *around* the code. |
| `testing` | Test infrastructure and strategy. |

The `architecture` / `process` line: architecture is the source we ship; process is the
surrounding tooling. There is deliberately no `refactor` class — it overlaps
`simplification`, whose discriminator ("does observable behaviour change?") already covers it.

The date is when the topic was **first proposed**, not when the file was last touched.
Cross-references between notes use relative markdown links — never bare prose or bare
numbers — so they survive a move between folders and can be checked mechanically.

There is no index file. Browsing the tree, or searching the repository, is the inventory;
an index is a second source of truth that drifts.

## When to write one

**Every non-trivial change adds or updates at least one note in the same change.**

Non-trivial means the change alters behaviour, architecture, a contract shared across files,
process or tooling, testing strategy, an on-disk or wire format, or any decision a maintainer
might reasonably revisit.

Exempt: a purely mechanical or local edit with no change to behaviour, contracts, structure,
process or rationale. Fixing a typo, renaming a local, adjusting a colour token.

Updating the note that already owns a decision satisfies the rule — **do not create a
duplicate.** Prefer editing the owner; supersede only when the decision itself changes.

A note is never edited into a *different* decision. Supersede it with a new one and
cross-link both. The one exception is factual drift: when code later moves a file, renames a
symbol, or changes a default, the note is updated in the same change to match. Paths and
names are facts; the decision is not.

## The file format

### Header

The first two lines of every note are exactly:

```markdown
# Agent Note: <title>

Status: <status>
```

followed by a blank line. The status must agree with the folder, and the gate cross-checks
them:

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <why, in one line>`

The status carries no dates and no parentheticals. The filename holds the date. The
rejection reason is the one status with content, because a rejected note's verdict is the
fact a reader comes for.

### Body

Every note opens with `## Problem` — the motivation, written to stand on its own without the
solution. Then, per lifecycle:

**`proposed/`**

```markdown
## Problem
## Proposal
…bespoke sections…
## Alternatives considered
## Acceptance criteria
## Risks
```

`## Proposal` may speak in the future tense; plans and open questions belong here.

**`implemented/`**

```markdown
## Problem
## Decision
…bespoke sections…
## Verification
## Alternatives considered
## Consequences
```

`## Decision` is present tense and describes shipped reality. `## Verification` names the
evidence that pins the behaviour — a test, a script, a measurement. `## Consequences` records
what the trade-off cost **and** bought.

Proposal-era headings are rejected in an implemented note: `## Proposal`, `## Plan`,
`## Migration plan`, `## Acceptance criteria`. Shipping means the plan is gone.

**`rejected/`**

The proposal, frozen: it keeps its proposal-time sections. The verdict lives on the
`Status:` line. No `## Decision`, no `## Consequences`.

### Alternatives considered — mandatory

Every note carries an `## Alternatives considered` section: each genuine alternative and why
it lost, as a bold-led paragraph per alternative or a `### Why not <X>?` subsection per
contested one.

Alternatives are **recorded, never invented.** If a decision predates this format and its
alternatives are genuinely not reconstructible, use this exact comment in place of the
section, which the gate accepts only for pre-format notes:

```markdown
<!-- agent-notes: alternatives-not-recorded (pre-format note) -->
```

### Images

A note may reference a file under `.agents/notes/assets/`. Keep them small and prefer a
number. A note that needs a diagram to be understood is usually a note that needs a clearer
`## Problem`.

## Keeping it healthy

A corpus of decisions rots in two directions: it grows without bound, and the notes drift out
of sync with the code they describe. Both are addressed here rather than by discipline.

**Supersession.** When a new note supersedes an existing one, classify the old one in the same
change: **fully** superseded means every unique rationale, rejected alternative and
reintroduction condition has been absorbed by the new owner, and the old note can be deleted.
**Partial** supersession is the common case — keep both, cross-link them, and update every
fact that is still current. Rationale that *could* be copied does not by itself make a
supersession full; the question is whether anything unique would be lost.

**Archiving.** Move an implemented note to `archived/{class}/` when the shipped decision is
complete and its rationale is unlikely to guide future work: one-off UI chrome, a narrow
adapter, a minor closed bug, process history whose current behaviour is obvious elsewhere.

Keep it active when any of these still has force: a rejected alternative someone might
retry, an ownership boundary, a negative guarantee ("narration carries no tools"), a wire or
disk format, a security rule, or a reintroduction condition.

Archiving is mechanical and irreversible:

1. Move the file from `implemented/{class}/` to `archived/{class}/`. Note that
   `implemented` does not appear in the archive path.
2. Insert `Archived: YYYY-MM-DD` immediately below the `Status:` line. **This is the only
   permitted edit.** Do not reformat, update facts, or repair the body.
3. Repair or delete inbound links from active notes.

Once archived, a note is frozen. Do not edit, move, reformat or delete it, and do not treat
it as authority for current behaviour — it is a snapshot. Active notes may still link into
the archive when they intentionally cite history.

**Deletion.** A rejected note is deleted outright when the idea it argues against is no
longer plausible — when it cannot prevent a mistake, it is noise. Delete the file and repair
inbound links.

Never archive toward a quota, and never judge by word count or age. A 200-word note about a
foundational boundary outlives a 2,000-word note about finished UI work. The question is
always whether the reasoning still has force.

## Divergences from the harness system

This format is adapted from `deepseek-harness/.agents/notes`. Two mechanisms were
deliberately dropped, because they solve problems this repository does not have:

- **Bilingual triplets.** Every DSH note exists as `.md`, `.zh.md` and `.i18n.yaml`, with a
  consistency gate per pair. Reepi is English-only, so notes are single files. If
  translation is ever added, the pairing rule belongs here.
- **Frozen-archive hash manifest.** DSH seals archived notes with recorded hashes and an
  append-only manifest, enforced by a verifier. That protects a 2,900-file corpus with
  multiple translators. Here the freeze is a convention with a one-line gate, which is
  proportionate to the corpus size.

Everything load-bearing was kept: the lifecycle, the classes, the mandatory alternatives
section, the "never edit into a different decision" rule, and the supersede-classify-delete
discipline.

## Validation

```bash
npm run verify:notes
```

Checks the closed lifecycle/class tree, the header block, the status/folder agreement, the
required sections per lifecycle, the forbidden proposal-era headings in implemented notes,
a non-empty `## Alternatives considered` (or the exact pre-format comment), the
`yyyy-mm-dd-` filename prefix, duplicate titles, and that every relative link resolves —
including links from this file into `.agents/skills/`. Run it after adding or moving a note;
it is instant and needs no API key.

The gate checks **form, never quality.** It will accept a well-formed note arguing something
false. Judgement calls — is this note still useful, does that rejected alternative still
matter, are two notes saying the same thing — are made by a reader, and the procedure for
them is the [reepi-agent-notes skill](../skills/reepi-agent-notes/SKILL.md).

