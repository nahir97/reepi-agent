# Agent Note: A character owns many chats

Status: implemented

## Problem

A card had exactly one conversation. That was enforced twice — `startChat` handed back the
existing row, and a partial unique index (`stories_character_id`) made a second row impossible
([a character chat is a story](2026-09-22-character-chats-are-stories.md) shipped both) — and it
broke the most ordinary roleplay action there is: **start over**.

One session produced both failures at once. A writer opened a chat with Augusta, then wrote her
greeting on the card. The chat stayed blank, because the greeting is only written when a chat is
*created* and the row already existed. The obvious fix — start a new chat — reopened the same
empty row, because a card may only have one. "New chat" was a lie: it could not begin anything.
The card's greeting was in the payload, priced, and unreachable.

## Decision

**A card owns as many chats as the writer wants, and starting one is a distinct gesture from
resuming one.**

- **The unique index is dropped.** It is a non-additive migration, which the additive list
  cannot express, so `pendingMigrations` detects it (looking for `stories_character_id` and
  pushing a sentinel) and `migrate` drops it and records it. Detecting it is what keeps the
  *automatic* pre-migration snapshot covering the change; a manual `db:backup` was taken before
  applying it, as `AGENTS.md` requires for a constraint drop. `POST_MIGRATION_INDEXES` no longer
  creates it, so a fresh file never has it either.
- **`startChat` always creates.** The `exists` outcome is gone, the route no longer answers 409
  for an existing chat, and the client's "a 409 means it exists after all" fallback went with it.
- **`stories.chatFor` returns the most recently written chat**, and `stories.chatsFor` lists
  them all. "Resume" is a click; "New chat" is a button. The three rosters build their
  per-character chat map newest-first and *first wins*, so a card's `Resume` lands in the latest
  conversation rather than whichever row the query happened to return.
- **Later chats are numbered** (`Augusta`, `Augusta (2)`, …). Cosmetic and reusable after a
  delete: a title is a label, not identity.
- **`POST /stories/:id/greeting` (`ensureChatGreeting`) heals an empty card chat.** A card chat
  with no messages gets its card's opening line, once, and the client calls this when it opens
  one. Before many-chats this could not be fixed from the card at all; now it also covers a
  greeting authored before its first chat is ever opened. Narrow by design: a card chat, an empty
  transcript, the opening line only (an existing chat has no picker to consult). A POST rather
  than a write hidden in the bundle GET — a read that mutates is a thing a maintainer re-derives
  wrongly.
- **The greeting picker is per creation.** `NewChatDialog` is now only a creation dialog; it no
  longer refuses to run when a chat exists, because existing chats are no longer its business.

## Alternatives considered

**Keep one chat per character and only heal the empty chat.** Rejected. It repairs the symptom in
front of us and nothing else: a conversation with turns could still never be restarted from the
greeting, and the whole point of the request was the SillyTavern shape.

**"Start over" as a destructive reset of the existing chat** (clear the messages, re-seed the
greeting). Rejected: it deletes prose as a side effect of an action that sounds like it begins
something. A new row is additive — the old conversation stays readable, and delete already exists.

**`chatFor` returning the oldest chat.** Rejected. The writer's question is "where did I leave
off", and that is `updated_at DESC`. The first chat of a card is not more canonical than the
fourth.

**Reusing the title as the chat's identity** (looking one up by `Augusta (2)`). Rejected: it
makes a label load-bearing and breaks the moment a chat is renamed or deleted. Ordering by
`updated_at` answers "which chat" without inventing an identifier.

**Dropping the index from the DDL alone.** Rejected: `CREATE UNIQUE INDEX IF NOT EXISTS` is a
no-op on a file that already has it, so the constraint would survive in every database that
mattered — the ones with data in them.

**Archiving the previous chat when a new one starts.** Deferred: the library rail already lists
every chat newest-first, and delete exists, so a second concept for "not right now" would be
surface without a question it answers.

## Consequences

- **The library rail grows with chats.** One afternoon produced five Augusta rows. Numbered
  titles plus `updated_at` ordering are the whole disambiguation, and they are cosmetic — a
  reader should not treat a number as an id.
- **Deleting a card deletes every chat it owns.** The FK cascade already did this; there is just
  more to take. The delete confirm names them all (`chatsOfCharacter`), which is unchanged.
- **The drop cannot be undone by re-adding the index while several rows exist.** Reversing to one
  chat per character means deleting all but the newest and *then* recreating the index — recorded
  so the reversal is not attempted by editing the DDL.
- **This is the first non-additive migration in the ledger.** Future constraint changes have the
  same shape: detect it so the snapshot fires, apply it in `migrate`, record it.
- **An empty card chat is now defined as "not opened yet".** A writer who deletes the only
  message in a card chat and reloads gets the opening line back; that is the same rule that heals
  the chat above, and it is the reason the heal is limited to an empty transcript.

## Verification

- `npm run verify:store` — **185/185**, including: a second `startChat` creates a second chat with
  a distinct id and its own seeded greeting; it is titled `Asper (2)`; `chatFor` returns the most
  recent; a second row for one character is legal; no `stories_character_id` index exists on a
  fresh file; and a card whose world is gone still resolves to the conversation it already has.
- **The migration against the real pre-change file.** Opening the backup taken immediately before
  this change (`reepi-2026-09-23T18-30-49-573Z.sqlite`) showed `stories_character_id` present
  before and absent after, the sentinel recorded in `schema_migrations`, an automatic
  `pre-migration:` snapshot logged, and three rows accepted for one character where the index
  would have refused the second. The live database reports the same
  (`stories.one_chat_per_character` in its ledger, no index).
- **Browser**, against a copy of the live database on its own port: the Discover card showed
  `Resume` and a `New` control for a card that has chats (and only `New chat` for one that has
  none); `Start a new chat with Augusta` created and opened `Augusta (4)` on her greeting; the
  rail listed every chat newest-first. A chat inserted with no messages and opened from the rail
  came back with the greeting as its opening turn — the heal path, driven from the client.
- `npm run verify:cache` — **86.2% overall (5632 hit / 904 miss)**, worst drift 9.9pt after the
  cold turn. A chat is still a story and the greeting is still a message, so no block moved; the
  numbers match the greeting change's run.
- `npx tsc --noEmit`, `npx vite build` and `npm run verify:notes` are clean.
