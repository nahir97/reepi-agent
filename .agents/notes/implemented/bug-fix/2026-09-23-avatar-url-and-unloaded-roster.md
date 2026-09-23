# Agent Note: An avatar is a URL, and the roster page has to ask for the roster

Status: implemented

## Problem

Reported as data loss: *"I can't see the character named Augusta, despite that you
said you had restored everything."* She was in the database the whole time — story,
card, cast membership, 967 tokens, present in every API response. Two independent
defects made her **invisible**, and neither was in the data:

### 1. Her portrait was stored as something that is not a URL

`data/reepi.sqlite` held `characters.avatar` = 123,192 characters of raw JPEG base64
with no `data:image/jpeg;base64,` prefix. An `<img src>` does not treat that as
"an image it cannot parse" — it treats it as a **relative path** and requests
`http://127.0.0.1:5273/9j/4AAQSkZJRg...`, a 600 kB URL, which the server answers
**431 Request Header Fields Too Large**. `Avatar` catches the error and falls back to
initials, so every one of her cards rendered as the letter *A*.

The cause was the app's own portrait picker:

```ts
// src/web/api.ts — used by AvatarField for `character.avatar`
return btoa(binary);        // raw base64, no prefix
```

So **every portrait set through the editor was broken**, while imported ones worked —
`CardCharacter.avatar` came from a card that already carried a data URL. Augusta was
simply the only card in this database whose portrait had been set by hand.

It had been visible in the console for three sessions as a 431 beside a 404. It was
reported once as "pre-existing bad data, harmless", which was wrong: bad data in a
URL position is a request, not a dead value.

### 2. The Characters page never loaded the library

`CharactersPage` read `castLibrary` and rendered the roster, but — unlike
`DiscoverPage` — it never called `loadCastLibrary()`. On a direct visit the store's
`castLibrary` is still `null`, so the page rendered **"No characters yet. Import a
card…"** and **"Reading your character library…"** at the same time: an empty state
printed over a request that was never made. A library of six cards looked like an
empty one.

## Decision

**One owner for what an avatar may be, and one effect that asks for the roster.**

### `src/server/avatars.ts` is the single reader

`normalizeAvatar(raw)` returns a verdict, and every write path calls it:

- `null`, `''`, `none` → `null` (the honest "no portrait").
- a `data:image/...;base64,` URL, or an `http(s)` URL → kept.
- **bare base64** → repaired into a data URL of the type read from the **magic
  bytes**. The app really produced this shape, so the reader understands it.
- anything else, including base64 that is not a recognised image → **refused**, with
  the reason, so a route can reject the write instead of storing a portrait that
  cannot be shown.

The magic-byte sniffing (`sniffImageType`) is what makes the repair exact rather than
a hopeful `image/png`: JPEG, PNG, GIF, WebP and AVIF are each identified from their
own signatures, and bytes that match none of them are refused rather than guessed at.

`isRenderableAvatar` is the one predicate for "a browser can show this", so a future
surface does not re-derive the rule.

### Every door uses it

- **`sanitiseCharacter` / `sanitisePersona`** normalise `avatar` and push a reason
  into `rejected` when they refuse it — the wire contract is unchanged (a string or
  `null`), but a prefixless value is now repaired on the way in instead of stored
  broken.
- **`cardToCharacter`** runs a card's own avatar through the same reader, so a card
  from the wider internet with a raw base64 portrait gets a working portrait. The
  original text stays in `meta.card`, so export still round-trips byte-for-byte.
- **The portrait control** now stores `fileToDataUrl(file)` — the prefix from the
  file's own MIME type — while the card *importer* keeps `fileToBase64`, which is
  raw base64 on purpose because the provider's format wants base64 in the body. Two
  jobs, two names; the old single helper was the bug.

### The existing rows are repaired, by a script that says what it did

`npm run db:avatars` reports, `-- --write` applies. It is idempotent (a repaired value
is already a data URL, so a second run finds nothing), it refuses rather than deletes,
and it prints one line per row. On this database it found exactly one:

```
REPAIR  characters  Augusta  — prefixless base64 image/jpeg, 123192 chars
1 to repair · 3 already renderable · 0 refused
```

### The roster page asks for the roster

`CharactersPage` gained the `loadCastLibrary()` effect its sibling already had. It is
also now impossible to read as a contradiction: the empty state is gated on the
library having actually been read, not on its contents.

## Alternatives considered

**Fix the rendering instead: give `Avatar` a prefix when the value looks like
base64.** Rejected as the primary fix. It would leave the database holding something
that is not a URL — exports, other clients and every future `<img>` would need the
same trick, and the wire format would keep a shape only this renderer understands.
The stored value is the bug; the renderer is where it became visible.

**Repair only in the client, at render time.** Rejected for the same reason, plus: a
client-side guess cannot know whether base64 is a JPEG or a PNG without decoding it,
and the server can.

**Sniff the type in the browser and store a data URL — no server work.** Rejected as
incomplete. It fixes the write path for new portraits and does nothing for the rows
already written, and it leaves the API accepting a bare string that no browser can
render. The server is the only place that guards every door, including the card
importer.

**Rewrite the repair as an additive migration.** Rejected: a migration is for schema,
and this is data whose *shape* changed while the column stayed `TEXT`. It also cannot
know an image's type, so it would either guess or drop portraits. A script that prints
what it does, and that a person can dry-run first, is the right instrument.

**Delete the refused avatars.** Rejected: a portrait whose bytes are not an image has
no recoverable content, but deleting it is still destroying the writer's file. Refusing
and reporting leaves them a card to replace; the write path stops new ones arriving.

**Make the empty state say "loading" until a flag flips.** Rejected as the whole fix —
it would have hidden the missing effect rather than adding the call, and a page that
reports an empty roster while a request pends is a page that reports the wrong thing
either way. It now loads, *and* the two states are gated on the read having happened.

## Consequences

- **The wire contract changed shape, not type.** `avatar` is still `string | null`,
  but a client that sends bare base64 now gets a data URL back rather than its own
  value echoed. That is the point, and it is worth knowing when reading the sanitiser's
  `rejected` messages — they now carry a reason in parentheses.
- **A refused avatar is a 400 with a sentence**, not a silent drop. `sanitiseCharacter`
  pushes `avatar (that value is neither a URL nor a recognised image …)` into
  `rejected`, so the writer is told what a portrait must be.
- **`fileToBase64` and `fileToDataUrl` are deliberately two functions.** Collapsing
  them is how this happened; the distinction is now stated at both definitions.
- **`db:avatars` is a repair, not a migration.** It stays in the repo because a
  database restored from a backup taken before this change has the same bad rows. It
  is listed in `README.md` beside the backup commands.
- **The 431 is gone from the console**, which had been reported as noise three times.
  A 4xx on an `<img>` request is never noise in this app: it means a card is rendering
  as initials. That is now written down in the note rather than relearned.

## Testing

`npm run verify:store` — **181/181**, eighteen of them new and free:

- `sniffImageType` reads PNG and JPEG magic bytes and refuses other bytes;
- a data URL, an `http(s)` URL and `none`/`null` are left alone;
- prefixless PNG base64 is repaired to `data:image/png;base64,…`, reported as a
  repair, and passes `isRenderableAvatar`; a prefixless JPEG is repaired as a JPEG;
- base64 that is not an image, a bare path, and a `javascript:` URL are all refused;
- **both PATCH sanitisers** repair a prefixless avatar, refuse a non-image, still
  accept `null` to remove one, and pass a good data URL through unchanged.

Live, on the repaired database: `npm run db:avatars` found exactly one row, refused
none; after `--write` her stored value reads `data:image/jpeg;base64,/9j/4AAQ…` at
123,215 characters. In the browser, both of her cards on Discover hold an `<img>` with
`naturalWidth > 0` and `src` beginning `data:image/jpeg;base64`, and the Characters
page now lists **6 cards** with her first, her portrait the 123,215-character data URL
and the other two resolving as well. The 431 is gone.
