---
name: reepi-agent-notes
description: Use when adding, superseding, archiving, deleting, or auditing Agent Notes in the reepi-agent repo — after any non-trivial change that needs its rationale recorded, when a note's facts have drifted from the code it describes, when a decision is re-litigated or reversed, or when deciding whether an implemented note still earns its place.
---

# Maintaining reepi's Agent Notes

The corpus in `.agents/notes/` carries the reasoning that code and `AGENTS.md` cannot: which
alternative lost, which mistake must not be repeated, which boundary is deliberate. Read
`.agents/notes/README.md` for the format and the rules; this skill is about the judgement calls
the format cannot make for you.

The corpus fails in two directions and both are quiet. It **grows without bound**, so the
reasoning that matters is buried among finished work. Or it **drifts**, so a note confidently
describes code that has since moved — and a stale note is worse than no note, because it is
believed.

## Before writing, find the owner

**A decision has exactly one owning note.** Before creating a file, search for the note that
already covers the topic — by mechanism, not by title, since a note about the payload cache may
be filed under `architecture` and named for something else entirely.

- If a note owns it, **edit that note**. Adding a second note for a decision that already has
  one produces two half-truths that will diverge.
- If your change *reverses* the decision, **supersede**: write a new note, cross-link both, and
  classify the old one in the same change.

An Agent Note is never edited into a different decision. That is the one hard rule. The
exception is factual drift — when code moves a file, renames a symbol, or changes a default,
the note is updated in the same change to match. Paths and names are facts; the decision is not.

## What deserves a note

Write one when a maintainer could reasonably revisit the decision, or when the reasoning is not
recoverable from the code.

**Write it:** a contract shared across files; a wire or disk format; a rejected alternative
someone might retry; a negative guarantee ("narration carries no tools"); an ownership boundary;
a reintroduction condition; a measurement that contradicts intuition.

**Do not write it:** a typo fix, a local rename, a colour token, a bug whose cause is obvious
from its fix. Non-trivial changes *must* record something — but that something may be an update
to an existing note rather than a new file.

The test that works: **would a competent stranger, reading only the code, plausibly undo this?**
If yes, write the note. If the code makes the answer obvious, the note is ceremony.

## Rejections are the most valuable entries

An `implemented/` note documents a decision. A `rejected/` note prevents one. The second is
worth more, because the failure mode it guards against is re-litigation: an idea that sounded
reasonable once, was measured, and lost.

Write a rejection when the idea will recur. The strong ones here share a property —
**they are falsifiable**. The note on reverting the module split does not argue from taste; it
records that a specific claim ("the splits forced artificial exports") was measured and came
back *123 exports, 123 used outside their file, zero artificial surface*. A rejection with
numbers survives a reader who disagrees with your judgement; a rejection with adjectives does
not.

Two rejections in this corpus came from genuine mistakes made during development — a
mechanical line-count rule and an attempted revert based on memory rather than measurement.
Both were kept deliberately. Recording your own errors is more useful than recording only your
decisions, because the error is the thing a future reader is most likely to repeat.

## Keeping it healthy

**Supersession.** When a new note supersedes an old one, classify it in the same change. *Full*
supersession means every unique rationale, rejected alternative and reintroduction condition has
been absorbed — the old note can be deleted. *Partial* is the common case: keep both,
cross-link, update every fact still current. Rationale that *could* be copied does not by itself
make it full; the question is whether anything unique would be lost.

**Archiving.** Move an implemented note to `archived/{class}/` when its reasoning no longer has
force. Keep it active when any of these still binds: a rejected alternative worth retrying, an
ownership boundary, a negative guarantee, a wire or disk format, a security rule, a
reintroduction condition.

Archiving is mechanical and the body is frozen: move the file, insert `Archived: YYYY-MM-DD`
below the status line, repair inbound links. **No other edit.** Do not "improve it while you are
there" — the frozen snapshot is the point, and its value is that it cannot be quietly updated
to agree with a later decision.

**Deletion.** A rejected note is deleted when the idea it argues against is no longer plausible.
A rejection that cannot prevent a mistake is noise. Repair inbound links.

**Never judge by word count or age.** A 200-word note about the transcript collapse outlives a
2,000-word note about finished UI work. The question is always whether the reasoning still has
force — not how long it is or how old.

## Divergences from the harness system

This format is adapted from `deepseek-harness/.agents/notes`. Two mechanisms were deliberately
dropped, because they solve problems this repository does not have:

- **Bilingual triplets** (`.md` + `.zh.md` + `.i18n.yaml` with a pairing gate). Reepi is
  English-only. If translation is ever added, the pairing rule belongs in the notes README.
- **A frozen-archive hash manifest** with an append-only verifier. That protects a 2,900-file
  corpus with multiple translators. Here the freeze is a convention plus a one-line gate, which
  is proportionate.

Everything load-bearing was kept: the lifecycle, the closed class set, the mandatory
alternatives section, the never-edit-into-a-different-decision rule, and the
supersede-classify-delete discipline.

## Validate

```bash
npm run verify:notes
```

Checks the lifecycle/class tree, the header block, status-versus-folder agreement, the required
sections per lifecycle, the forbidden proposal-era headings in implemented notes, a non-empty
`## Alternatives considered`, the `yyyy-mm-dd-` filename prefix, and that inter-note links
resolve. Instant, no API key. Run it after adding, moving or deleting a note.

## Reporting

When you have changed the corpus, report what you did to it: notes added, notes updated,
notes superseded (naming old and new owner, and whether full or partial), notes archived, notes
deleted. Name any genuinely borderline retention call and the reason it went the way it did —
those are the judgements a reviewer needs to see, and they are the ones the format cannot make
on your behalf.
