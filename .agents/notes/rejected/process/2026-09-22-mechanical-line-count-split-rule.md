# Agent Note: The mechanical line-count split rule

Status: rejected — a line count is a symptom, and making it a target causes over-splitting

## Problem

The module split needed a rule for *when* to split, and the first version written into
`AGENTS.md` was:

> Nothing in `src/` should exceed **~400 lines**. When a file does, split it behind a barrel.

This is easy to check, easy to enforce, and wrong. It instructs a future contributor — human
or agent — to treat a number as the goal, which produces files that are individually small
and collectively harder to follow: a split whose only justification is arithmetic.

The rule also contradicted the code that had just been reviewed. `orchestrator.ts` is 704
lines of one cohesive lifecycle. Under the rule as written it is a violation awaiting a
fix, and the fix would be worse than the file.

## Proposal

Replace the numeric threshold with an ordered set of judgement tests, and state explicitly
that size is a prompt to ask them rather than an answer.

1. **Does the file have more than one reason to change?** `routes/library.ts` was input
   validation + story recreation + HTTP routing — three consumers, three change rates. That
   is a real case for splitting.
2. **Does it have two unrelated groups of callers?** `agents.ts` was five agentic passes that
   never referenced each other.
3. **Would a schema change and its reader land in one edit?** This is why `server/store/` is
   one file per entity: the row mapper sits beside the DAO that owns it.

Size is mentioned only as a prompt to ask those three questions. Around 700 lines of
cohesive logic is not a problem.

The rule also needs a prohibition, because rules about splitting invite a specific failure:

> Do not split one cohesive unit across files to satisfy a target, or create a module whose
> only content is a re-export of a single sibling. A file that exists to satisfy symmetry is
> worse than a long file that reads straight through.

## Alternatives considered

**Keep ~400 and accept the false positives.** Rejected because the false positives are not
cheap. Every unnecessary split costs a barrel, an import line, a place for the reader to
look, and a risk of moving shared mutable state (`activeController`) somewhere that breaks
`abort()`. The rule would pay those costs to improve a number no one reads.

**Keep ~400 but raise it to ~800.** Rejected as the same error with a different constant. The
number would still be the instruction, and `orchestrator.ts` at 704 would still be under
suspicion for no structural reason.

**No rule at all; leave it to judgement.** Rejected because judgement without a stated
criterion is unauditable. A reviewer needs to be able to say *which* test a split failed.
The three questions are that criterion; the number was the pretence of one.

**Measure by something else numeric — cyclomatic complexity, import count.** Rejected
because it substitutes a different proxy for the same mistake, and because cohesion is not
measurable by any single local metric. The three questions are cheap to ask and directly
about the thing that matters.

## Consequences

- `AGENTS.md` and `README.md` carry the three tests instead of a threshold, and both name
  `orchestrator.ts` at ~700 lines as an explicit non-problem so a future contributor has a
  counter-example rather than a licence.
- The judgement is now arguable, which is the point. Two reviewers can disagree about whether
  a file has one reason to change and resolve it with an argument about the code rather than
  about a number.
- This note is the guardrail: the 400-line rule is a *tempting* mistake because it is crisp
  and mechanical, and crisp-and-mechanical is exactly what a rule looks like from a distance.
  It is recorded in `rejected/` for that reason rather than deleted.
