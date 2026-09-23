# Agent Note: Snapshots before schema changes, and a restore that cannot surprise you

Status: implemented

## Problem

The database is the entire product — every story, transcript, character, memory and
cost event — and until this change it had **no backup story at all**. The only reason
the one schema accident in this repo's history was survivable is that a copy of the
file happened to be made by hand, by an agent, before the repair.

That accident is worth stating precisely, because it is not the failure a naive backup
plan addresses:

`stories.template_id` was declared as `TEXT REFERENCES prompt_templates(id) ON DELETE
SET NULL`. The column existed in the DDL and in the migration list; an existing
database migrated it in. The design then changed — the shipped templates are code
constants with no rows, so a foreign key rejects the most likely value the column will
ever hold — and the column became a plain `TEXT`. **The file was already wrong, and
SQLite cannot drop a constraint.** `ADDITIVE_MIGRATIONS` only ever adds, so nothing
could repair it. The fix was to drop `stories` and `scenes`, recreate them from the
current DDL, and copy the rows back.

Three things had to change for that to be a process rather than a rescue:

1. Nothing ran *before* a migration. A migration is the one operation in the process
   that can destroy data, and it ran on an unprotected file.
2. There was no supported way to move a database backwards. The repair was `rm`-and-
   hope, which is a data-loss footgun sitting next to the data.
3. Nothing recorded what had been applied to a file. "Was this column added here, or
   did it come in with the file?" was answerable only from a console that had long
   since scrolled away.

## Decision

**Snapshot before migrating, keep a rotation, and make restore a first-class command
that cannot surprise you.**

### The snapshot is `VACUUM INTO`

`src/server/backup.ts`. One statement, three properties, and each one rules out the
obvious alternative:

- **A file copy is not a backup.** The database runs in WAL mode, so the newest
  committed work lives in `reepi.sqlite-wal` until a checkpoint. Copying
  `reepi.sqlite` alone silently loses recent turns — the exact failure a backup exists
  to prevent. `VACUUM INTO` reads committed data regardless of where the log sits.
- **It is atomic.** The copy is taken inside one transaction, so a concurrent write
  lands before or after it, never half in.
- **It compacts.** A fresh file with no free pages, so a much-rewritten database
  snapshots smaller than it is.

The snapshot is built as `<name>.partial` and renamed into place, so a crash halfway
through never leaves a file that looks like a finished backup. Its integrity is checked
**after** it is written and before it is renamed — the file a restore would actually
use is the file whose health matters. Metadata (timestamp, reason, size, integrity,
tables, row counts) is written beside it as JSON, so a snapshot describes itself and
`db:list` and the Settings panel do not have to open every file.

### The guard runs before the migration, not after it

`openDatabase` now splits the migration into three steps: **detect** pending additive
columns (`PRAGMA table_info`, changing nothing), **snapshot** if there are any, and only
then **migrate**. On a normal boot the cost is one pragma per known column and no disk
at all.

A failure to back up is deliberately **not** fatal. Refusing to boot because the disk
is full turns "you have no backup" into "you have no app", and the library is still on
disk and readable — so the loud line is the mitigation and the operator runs
`npm run db:backup` once the disk is sorted. A backup system that can take the app
down is a worse failure than no backup system.

### Every applied migration is recorded

`schema_migrations (name, applied_at)`. The log line is the warning; the table is the
record. It is best-effort — a failure to write it must not fail an otherwise successful
boot — and it is read by humans, not by code deciding what to do.

### Restore refuses, keeps, and consumes

Three rules, each from a way this could hurt someone:

- **It refuses a snapshot that fails verification.** `verifyBackup` opens the file
  read-only, runs `PRAGMA quick_check`, and requires a `stories` table — so a
  truncated file, or a SQLite file of some other shape, cannot be written over a
  working database.
- **It keeps the file it displaces**, as `<db>.replaced-<stamp>`. A restore is the only
  operation here that can lose the writer's most recent work; deleting the state it
  overwrote would make it the most dangerous command in the repo.
- **It clears `-wal` and `-shm` beside the target.** A stale write-ahead log beside a
  restored database is applied to it on open — corrupting the very thing being
  restored.
- **It consumes the snapshot.** The file is *moved* into place, so it is no longer a
  backup. That is a feature: leaving it would let a second restore silently reuse a
  copy that is now one generation stale.

### Four ways in, one behaviour

- **Automatic**, before additive migrations (`openDatabase`).
- **On demand**, `npm run db:backup [-- verify] [-- prune] [-- "reason"]`.
- **Scheduled**, `REEPI_BACKUP_EVERY_MINUTES=30` — off by default, because the common
  failure here is not disk death but a bad edit, which the other three cover.
- **From the app**, `POST /api/backups`, surfaced as a **Safety** section in Settings
  that reports how many snapshots exist, when the newest was taken, whether it still
  passes its own integrity check, and offers one button to take another.

`GET /api/backups` never returns a filesystem path — the client has no use for one, and
a path is a piece of the server this contract has no business leaking. Restoring is
deliberately **not** in the app: it belongs behind a shell where it is typed on purpose.

Rotation keeps the newest 12. The newest snapshot is **never** deleted even when the
limit is zero, because a rotation policy that can empty the folder is a policy that
will.

## Alternatives considered

**A copy of the `.sqlite` file on an interval.** Rejected: with WAL on, that copy is
missing the newest committed work, and it is the version of "backup" most likely to be
implemented and then trusted. It would have failed on exactly the day it was needed.

**Back up on every write.** Rejected as the wrong instrument. Every turn writes; a
snapshot per write is disk churn for a threat (bit-rot mid-session) that
`PRAGMA quick_check` already detects cheaply. The risk here is a *deliberate* change —
a migration, a rebuild — and those are countable events.

**A scheduled snapshot, on by default.** Rejected as the default: it spends disk on
every deployment including the ones with a real backup story (file system snapshots,
`litestream`, a nightly `pg_dump` equivalent), and it does not protect the case that
actually happened. Available behind `REEPI_BACKUP_EVERY_MINUTES` for unattended
installs.

**Ship `litestream` or a WAL-archiver.** Genuinely better continuity than periodic
snapshots — point-in-time, off-host, no gaps. Rejected **for now** as a dependency and
an operational surface: it is a separate binary, a destination to configure, and
credentials, and this repo's zero-native-build-steps rule is deliberate. It is the
right next step for a hosted deployment, and recording the rejection here is how that
stays a decision rather than a re-derivation.

**Make the pre-migration guard fatal when it fails.** Rejected: see above. Turning a
missing backup into a non-booting app converts a recoverable problem into an outage.

**A `db:restore` that prompts for confirmation.** Rejected as insufficient and
annoying at once — a `y/n` is not protection, and the actual protections (verify the
snapshot, keep the displaced file, clear the stale log) are mechanical rather than
conversational. The CLI prints what it kept and what to run next, which is more useful
than a prompt.

**Put restore in the Settings panel.** Rejected: it is the one action that can lose the
most recent work, and the app is where a writer is least deliberate. The panel reports;
the shell acts.

**Track schema version and refuse to open a newer file.** Considered and deferred: a
`user_version` guard is worth having, but this change's job is recoverability, and a
version gate that refuses to boot is the same footgun as a fatal backup failure. The
migration ledger is the piece that makes a future gate safe to add.

## Consequences

- **A pre-migration snapshot doubles as the record of the old shape.** `verify:store`
  opens the snapshot and checks that `template_id` is *absent* from it — i.e. that the
  snapshot was taken from before the migration, not after. That is the property the
  whole guard rests on, and it is asserted rather than assumed.
- **Rotation is bounded but not infinite.** 12 snapshots; a database that grows to
  hundreds of megabytes after each of twelve daily rebuilds is a real disk
  consideration, and the answer is `REEPI_BACKUP_KEEP`/pruning rather than keeping
  everything.
- **A snapshot is not a point-in-time recovery.** Work committed since the newest
  snapshot is gone on a restore. `db:list` and the Settings panel both print the age
  for that reason: *how much* would be lost is the number that matters, and it is
  visible.
- **`data/backups/` is inside the gitignored `data/`**, so snapshots are never
  committed. They are also never garbage-collected by anything but the rotation —
  deleting the folder is the operator's call and is not needed for correctness.
- **The Settings panel reports the stored integrity for older snapshots** and
  re-checks only the newest on each load, because it backs a panel that opens on a
  settings page. `?verify=all` and `npm run db:list` re-check every file, which is the
  path that catches a rotted older snapshot.
- **A schema change that cannot be expressed as `ALTER TABLE ADD COLUMN` still requires
  the operator to run `db:backup` first.** The guard cannot know a rebuild is coming.
  This is stated in `AGENTS.md` under *The database is the product*, which is the file a
  future agent reads before touching the schema — the mitigation is a rule plus the
  commands, not a mechanism.

## Testing

`npm run verify:store` — **158/158**, fifteen of them new:

- snapshot written, passes SQLite's own check, metadata names its tables and counts its
  rows, `verifyBackup` accepts it, `listBackups` finds it;
- a deleted row is gone before the restore and **comes back after it**, with its
  columns, and the restored file has no dangling foreign keys;
- the displaced file is kept;
- a file that is not a database is rejected, and `restore` refuses rather than
  overwriting;
- rotation removes the older snapshots, keeps the newest at a limit of zero, and a
  restore is shown to consume its snapshot;
- **the guard**: a file rebuilt without `template_id` is detected as pending, the boot
  applies the migration, exactly one snapshot exists, its reason says `pre-migration`,
  **the snapshot does not contain the column the migration added**, and the ledger
  records the migration.

Live: `npm run db:backup -- verify` wrote and verified a real 396 kB snapshot;
`npm run db:list` read it back with counts; `npm run db:verify` reported `integrity:
ok · 22 tables · 7 stories · 10 messages · 0 dangling foreign keys`; `GET /api/backups`
returned it without a path.
