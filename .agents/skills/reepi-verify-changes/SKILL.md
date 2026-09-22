---
name: reepi-verify-changes
description: Use when claiming any change to the reepi-agent repo works — before marking work complete, after a refactor or file move, when adding a route or endpoint, or when a change compiles but has not been run. Selects the smallest evidence that actually covers the change, including which of verify:cache, verify:store, verify:tx, the browser, or a throwaway script applies.
---

# Proving a change to reepi works

This repository has four verification mechanisms and one recurring failure: **trusting
`tsc` as proof.** A clean typecheck means the types line up, nothing more. Two separate
incidents here were green under `tsc` and broken at runtime — a module that typechecked and
then crashed the server on import, and a feature that compiled and returned `404` on every
request because a route had never been registered.

This skill is about choosing evidence that would actually fail if the change were wrong.

## The bar

A change is verified when you have **observed the thing you changed doing its job** — not when
it compiles, not when a nearby thing still works, and not when the code "obviously" does what
it says.

Match the evidence to the claim:

| You changed | Evidence that covers it |
|---|---|
| A prompt block, the composer, an agent prompt | `npm run verify:cache` — read the measured hit rate and drift |
| `db.ts`, `store/`, bundle recreation, any multi-row write | `npm run verify:store` **and** `npm run verify:tx` |
| Any route or endpoint | Boot the server and call it, including one error path |
| A UI component, layout, or interaction | Browser check at more than one width; read the real DOM |
| A refactor that moves code | `tsc`, then boot the server, then exercise one route per moved module |
| Money, usage, or cost arithmetic | A real call whose figures you read back from the database |

## Compiling is not running

**Always boot the server after a structural change.** A moved function that lacks an `export`
typechecks in its own file and throws when the module graph is instantiated. The failure
appears at import time, which no static check reaches.

```bash
npm run dev            # then hit /api/health
```

If the server does not start, nothing else you measured matters.

## The four mechanisms

**`npm run verify:cache`** — drives the real composer against the live API in a throwaway
database and prints per-turn prediction against the API's own hit accounting. Costs a fraction
of a cent. This is the only check that proves the payload discipline holds; use it for anything
touching blocks, the composer, or agent prompts. See
[reepi-cache-discipline](../reepi-cache-discipline/SKILL.md).

**`npm run verify:store`** — 22 DAO round-trips against a real database, including JSON columns,
the new `personas.avatar` column, cascade deletes and the cross-cutting bundle read. Free,
instant. It pins behaviour *by name*, so a rename that breaks a call site fails here.

**`npm run verify:tx`** — proves `transaction()` rolls back, commits, and refuses nesting. The
rollback case is the one that matters: a commit that works proves nothing about what happens
when the third of ten writes throws.

**The browser** — for anything the writer sees. Compiling JSX proves nothing about layout.
Take a screenshot and read the DOM; measure `scrollWidth` against `clientWidth` rather than
eyeballing it, because overflow is invisible in a screenshot of the overflowing element.

## Reading the result honestly

Three specific traps, each of which has produced a false pass here:

**A test that passes because it used the wrong input.** A probe sent `format=text` and saw
`200`, then concluded markdown export worked. The UI sends `format=markdown`, and the route
accepts `markdown` for *export* and `text` for *import* — different operations, deliberately
different vocabularies. The probe had tested a third thing. When a check passes, ask whether
the input matched what the application actually sends.

**A check that cannot fail.** A verification whose success condition is also its failure
condition proves nothing. Before trusting a green result, state what a wrong implementation
would have produced and confirm the check would have said so.

**Silence read as success.** A background job or subagent that reports "done" without
artifacts has not done anything. Verify the claim: does the file exist, does the route respond,
does the number come back. In this repository a subagent reported a complete split while no
files had been written.

## When a check passes but the thing is broken

Suspect the *harness*, not the code. In order of likelihood:

- The server is serving a stale `dist/`. Run `npx vite build` — it is not automatic.
- The check exercised a different path than the user does (the `format=text` trap above).
- The check asserted the implementation rather than the behaviour: it confirmed a function was
  called, not that the result was right.
- The measurement was taken before the change propagated.

## What not to do

- **Do not re-run a check the user has already reported passing or failing.** Their report is
  the evidence.
- **Do not run `git diff` or `git status` to "verify" an edit.** The tool result is the
  verification.
- **Do not write a test to make a claim look verified.** A throwaway script that exercises the
  real path is better than a permanent test that asserts a mock was called.
- **Do not widen a claim beyond what you measured.** "The route returns 200 with the avatar
  preserved" is a claim; "export works" is not, unless you tested every format.

## Reporting

State the command, the observed output, and the number. Cite figures over adjectives, and when
something is unverified, say which part and why. A truthful "the store split is verified by
`verify:store` and a browser turn, but I did not test import of a chara card" is worth more
than an unqualified "done".
