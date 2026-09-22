# Agent Note: `npm run dev` serves a build, so say so at boot

Status: implemented

## Problem

The README said:

```bash
npm run dev                 # API on :8787, UI on :5273
```

One command, both surfaces, as far as a reader can tell. It is not what happens. `npm run dev`
starts `src/server/index.ts`, which mounts `serveStatic` over `dist/` — so `:8787` serves the API
*and the last UI build*. The live UI is `npm run dev:web` (Vite, `:5273`), which the block did not
mention at all.

The failure this produces is silent, which is what makes it worth a note. A shipped feature was
reported missing from the sidebar, the studio list and the cast page — because `:8787` was serving
a `dist/` built hours earlier. The app worked perfectly; it was simply an older app. The same trap
is already recorded in the verification skill ("the server is serving a stale `dist/` — run
`npx vite build`"), which is the sign that it keeps catching people rather than being a one-off.

## Decision

**Keep `:8787` serving the build, and make staleness loud: a boot warning, corrected docs, and a
door from the page the writer was actually looking at.**

- `src/server/index.ts` compares the newest mtime under `src/` (plus the root `index.html`) against
  `dist/index.html` at boot, and prints one of two lines: no UI build at all, or `dist/` is OLDER
  than `src/` — each naming the fix (`npm run build`, or `npm run dev:web` for the live UI on
  `:5273`). It is a warning on stderr, not an error: serving the build is the correct production
  behaviour, and a fresh checkout with no build yet is a legitimate way to run the API alone.
- The README's development block is now two processes in two terminals, and says which port serves
  what and why `:8787` can be behind.
- The cast page's band gained an **Assistant** button. It is not a fix for staleness, but it is the
  answer to the question the staleness raised — "where do I write a character?" — on the page a
  writer asks it from. Pressing it points the assistant's chat at *that* story as it opens it, which
  is the one automatic target change the design allows: the writer pressed a button that says where
  it will write.

## Alternatives considered

**Make `npm run dev` also start Vite.** The most attractive option, and rejected on portability:
without adding a process manager (`concurrently`, `npm-run-all`) it is a shell one-liner that leaks
a background job and handles `Ctrl+C` differently per platform. Adding a dependency to fix a
documentation bug is the wrong trade. If a process manager is ever added for other reasons, folding
the two dev commands into one is the first thing it should do.

**Stop serving `dist/` from the dev server.** Rejected: the static mount is the production code
path, and a dev server that does not exercise it will not notice when it breaks — the SPA fallback
and the asset paths are exactly what a "shipped but missing" bug looks like.

**Warn in the browser instead of the terminal.** A banner in the UI would be seen by everyone
running the app, including people using it as a product who do not care that a source file is newer
than a build. The terminal is where the person who can fix it is looking.

**Rely on the corrected README alone.** Rejected: the README is read once, and the failure happens
weeks later, silently. The warning costs one `readdirSync` walk of `src/` at boot.

**Print it as an error and refuse to boot.** No: a stale build is a legitimate state — `npm start`
after editing source, serving the last good build. It must be visible, not fatal.

## Consequences

- **Boot reads `src/` once.** Forty-odd `statSync` calls on a local disk, before the server listens.
  Best effort by construction: the whole walk sits in one `try`, and anything that goes wrong — a
  deployment that ships `dist/` without `src/`, a file that vanishes mid-walk — reports "fresh". A
  diagnostic must never be able to become a boot failure, and with no source to compare there is no
  claim to make.
- **Two dev commands, documented honestly**, and `:8787` after `npm run build` is a supported way to
  use the app without Vite.
- **The assistant is reachable from the cast page**, so the surface is findable from the two places
  a writer looks for content: the library rail and the roster.
- The warning goes to stderr and changes no response: `/api/health` and every other payload are
  untouched by it.

## Testing

Booted with a touched source file and a build older than it: the stale line printed on stderr.
Rebuilt, booted again: no line. The cast page's Assistant button was clicked in a production build
serving a fresh `dist/`, and the assistant opened with `Write into` already set to that story.
`npm run typecheck`, `npm run verify:notes` and `npm run verify:store` (131/131) pass.
