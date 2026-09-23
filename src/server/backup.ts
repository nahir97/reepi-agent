/**
 * Backups, and the one restore path.
 *
 * ## Why this exists
 *
 * The database is the whole product: stories, transcripts, characters, memories,
 * and the cost ledger. A schema change that goes wrong is not a bug you fix in code
 * — it is data you do not get back. That happened once already: a column was added
 * with `REFERENCES prompt_templates(id)`, which an existing file then carried
 * forever, because SQLite cannot drop a constraint and this repo's migration system
 * (correctly) only ever *adds*. The fix was to drop and recreate two tables and copy
 * the rows back by hand, with a copy of the file made first as the safety net. This
 * module is that safety net, made automatic.
 *
 * ## What a snapshot is
 *
 * `VACUUM INTO` — a single statement that writes a compacted, fully consistent copy
 * of the database to a new file. Three properties make it the right primitive here
 * and rule out the obvious alternative:
 *
 * - **A file copy is not a backup.** The database runs in WAL mode, so the newest
 *   committed data lives in `reepi.sqlite-wal` until a checkpoint. Copying
 *   `reepi.sqlite` alone silently loses recent work — the exact failure a backup is
 *   supposed to prevent.
 * - **It is atomic.** The copy is taken inside one transaction; a concurrent write
 *   either lands before it or after it, never half in.
 * - **It compacts.** The snapshot is a fresh file with no free pages, so a backup of
 *   a much-rewritten database can be smaller than the original.
 *
 * ## What a snapshot is not
 *
 * It is not a substitute for a migration being careful, and it does not make a
 * destructive `DROPD`-then-`CREATE` safe to run casually. What it does is make the
 * *starting point* recoverable, which is the difference between a bad afternoon and
 * a lost library.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** How many snapshots to keep per database, newest first. */
export const KEEP_BACKUPS = 12;

const PREFIX = 'reepi-';
const SUFFIX = '.sqlite';
const META_SUFFIX = '.meta.json';

export type BackupMeta = {
  /** ISO timestamp the snapshot was taken. */
  at: string;
  /** The database it was taken from, as written by the caller. */
  source: string;
  reason: string;
  /** Bytes of the snapshot file. */
  bytes: number;
  /** ISO timestamp the snapshot file's mtime was observed. */
  mtime: string;
  /** What SQLite's own integrity check said when the snapshot was taken. */
  integrity: string;
  /** The tables it holds, so a reader can see what "a backup" actually contains. */
  tables: string[];
  /** Row counts of the things a writer would miss most. */
  counts: Record<string, number>;
};

export type BackupFile = {
  file: string;
  path: string;
  meta: BackupMeta | null;
};

/**
 * Where snapshots live: a directory beside the database, never inside it.
 *
 * Beside, so a restore is a file operation and the directory can be copied to
 * another disk or a synced folder without the database having to move too.
 */
export function backupDirFor(dbPath: string): string {
  return join(dirname(resolve(dbPath)), 'backups', basename(dbPath).replace(/\.sqlite$/, ''));
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** Timestamps are the whole ordering; the name must sort chronologically as text. */
function fileName(at: Date): string {
  return `${PREFIX}${stamp(at)}${SUFFIX}`;
}

/**
 * Fold any `-wal` beside a file back into it.
 *
 * Not needed for the snapshot's consistency — `VACUUM INTO` reads committed data
 * regardless — but it keeps the directory tidy and makes any *other* tool that
 * reads the file see everything.
 */
function checkpoint(dbPath: string): void {
  if (dbPath === ':memory:' || !dbPath) return;
  let handle: DatabaseSync | null = null;
  try {
    handle = new DatabaseSync(dbPath);
    handle.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* Best effort: a snapshot taken without a checkpoint is still consistent. */
  } finally {
    handle?.close();
  }
}

function countsOf(handle: DatabaseSync): { tables: string[]; counts: Record<string, number> } {
  const tables = (
    handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);

  const counts: Record<string, number> = {};
  for (const table of tables) {
    /* A table name from `sqlite_master` is not user input, but it is still
       interpolated into SQL; the double quotes are the guard. */
    const row = handle.prepare(`SELECT COUNT(*) AS n FROM "${table.replace(/"/g, '""')}"`).get() as
      | { n: number }
      | undefined;
    counts[table] = Number(row?.n ?? 0);
  }
  return { tables, counts };
}

/**
 * Take a snapshot of `dbPath`.
 *
 * Throws on any failure rather than returning a falsy value: every caller here
 * treats "the backup did not happen" as something the operator must be told about,
 * and a boolean a caller can forget to check is how a backup system becomes
 * decorative.
 */
export function createBackup(dbPath: string, reason = 'manual'): BackupFile {
  if (!dbPath || dbPath === ':memory:') {
    throw new Error('Cannot back up an in-memory database');
  }

  const dir = backupDirFor(dbPath);
  mkdirSync(dir, { recursive: true });
  const at = new Date();
  const file = fileName(at);
  const target = join(dir, file);

  checkpoint(dbPath);

  /* The snapshot is built in a scratch name and renamed into place, so a crash
     halfway through leaves no file that looks like a finished backup. */
  const scratch = `${target}.partial`;
  rmSync(scratch, { force: true });

  const source = new DatabaseSync(dbPath);
  try {
    /* VACUUM INTO refuses to overwrite, which is a feature: the name carries a
       millisecond timestamp, and an existing file means something is wrong. */
    source.prepare('VACUUM INTO ?').run(scratch);
  } finally {
    source.close();
  }

  /* Integrity is checked on the *snapshot*, not the source: that is the file the
     restore would use, so that is the file whose health matters. */
  const snapshot = new DatabaseSync(scratch);
  let integrity = 'unknown';
  let tables: string[] = [];
  let counts: Record<string, number> = {};
  try {
    integrity = String(
      (snapshot.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined)?.quick_check ?? 'unknown',
    );
    if (integrity === 'ok') ({ tables, counts } = countsOf(snapshot));
  } finally {
    snapshot.close();
  }

  if (integrity !== 'ok') {
    rmSync(scratch, { force: true });
    throw new Error(`Snapshot failed SQLite's integrity check: ${integrity}`);
  }

  renameSync(scratch, target);
  const stats = statSync(target);

  const meta: BackupMeta = {
    at: at.toISOString(),
    source: resolve(dbPath),
    reason,
    bytes: stats.size,
    mtime: new Date(stats.mtimeMs).toISOString(),
    integrity,
    tables,
    counts,
  };
  writeFileSync(join(dir, `${file}${META_SUFFIX}`), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  return { file, path: target, meta };
}

/** Every snapshot in the directory, newest first. Unreadable metadata is `null`. */
export function listBackups(dbPath: string): BackupFile[] {
  const dir = backupDirFor(dbPath);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  return names
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .sort()
    .reverse()
    .map((file) => {
      const path = join(dir, file);
      let meta: BackupMeta | null = null;
      try {
        meta = JSON.parse(readFileSync(join(dir, `${file}${META_SUFFIX}`), 'utf8')) as BackupMeta;
      } catch {
        /* A snapshot without metadata is still a snapshot; it just cannot describe
           itself. Reported as null rather than hidden, because a file in this
           directory that cannot describe itself is worth looking at. */
      }
      return { file, path, meta };
    });
}

/**
 * Delete all but the newest `keep` snapshots.
 *
 * Returns what it removed, so a caller can report it rather than doing it silently.
 * The newest snapshot is never deleted even when `keep` is zero: a rotation policy
 * that can empty the directory is a policy that will.
 */
export function pruneBackups(dbPath: string, keep = KEEP_BACKUPS): string[] {
  const files = listBackups(dbPath);
  const doomed = files.slice(Math.max(1, keep));
  for (const entry of doomed) {
    rmSync(entry.path, { force: true });
    rmSync(join(dirname(entry.path), `${entry.file}${META_SUFFIX}`), { force: true });
  }
  return doomed.map((entry) => entry.file);
}

/**
 * What a file says it is, without being trusted.
 *
 * A snapshot that has been truncated, half-copied or edited by hand must not be
 * restored over a working database. Everything here is read from the file itself.
 */
export type BackupCheck = {
  file: string;
  ok: boolean;
  detail: string;
  tables: number;
  counts: Record<string, number>;
};

export function verifyBackup(path: string): BackupCheck {
  const file = basename(path);
  let handle: DatabaseSync | null = null;
  try {
    handle = new DatabaseSync(path, { readOnly: true });
    const integrity = String(
      (handle.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined)?.quick_check ?? 'unknown',
    );
    if (integrity !== 'ok') return { file, ok: false, detail: integrity, tables: 0, counts: {} };

    const { tables, counts } = countsOf(handle);
    /* A snapshot with no `stories` table is not a Reepi database this version can
       restore — a SQLite file of some other shape would otherwise pass. */
    if (!tables.includes('stories')) {
      return { file, ok: false, detail: 'no stories table', tables: tables.length, counts };
    }
    return { file, ok: true, detail: 'ok', tables: tables.length, counts };
  } catch (error) {
    return { file, ok: false, detail: error instanceof Error ? error.message : String(error), tables: 0, counts: {} };
  } finally {
    handle?.close();
  }
}

/**
 * Put a snapshot back where the database was, keeping the file it replaced.
 *
 * The replaced file is moved aside as `<db>.replaced-<stamp>` rather than deleted —
 * a restore is the most dangerous operation in this module, and the state it
 * overwrote is the only copy of whatever the writer did since the snapshot.
 * `-wal` and `-shm` are removed, because a stale log beside a restored database
 * would be applied to it on open and corrupt the very thing being restored.
 */
/**
 * **A restore consumes the snapshot.** The file is moved into place, so it is no
 * longer a backup — and that is deliberate. A restore is the only operation here
 * that can lose the writer's most recent work (it replaces the live database with
 * an older one), so leaving the snapshot in the folder would let a second restore
 * silently reuse a copy that is now one generation stale. Take a fresh snapshot
 * after a restore if you want a new starting point.
 */
export function restoreBackup(dbPath: string, backupPath: string): { restored: string; displaced: string } {
  if (!dbPath || dbPath === ':memory:') throw new Error('Cannot restore an in-memory database');

  const check = verifyBackup(backupPath);
  if (!check.ok) throw new Error(`Refusing to restore ${basename(backupPath)}: ${check.detail}`);

  const target = resolve(dbPath);
  const displaced = `${target}.replaced-${stamp(new Date())}`;
  mkdirSync(dirname(target), { recursive: true });

  for (const suffix of ['-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true });
  try {
    renameSync(target, displaced);
  } catch {
    /* No existing file is a legitimate restore target: a fresh install from a
       snapshot. Nothing to displace. */
  }
  renameSync(backupPath, target);

  return { restored: target, displaced };
}

/* --------------------------------------------------------------- scheduling */

let timer: NodeJS.Timeout | null = null;

/**
 * Snapshot on an interval, if the operator asked for one.
 *
 * Off by default. An interval that is on unless disabled spends disk on every
 * deployment including the ones that already have a real backup story, and the
 * common failure here is not disk death — it is a migration or a bad edit, which
 * the pre-migration snapshot and `npm run db:backup` both cover.
 *
 * `REEPI_BACKUP_EVERY_MINUTES=30` turns it on; `0` or absent leaves it off.
 */
export function startBackupSchedule(dbPath: string, log: (line: string) => void = console.log): void {
  stopBackupSchedule();
  const minutes = Number(process.env['REEPI_BACKUP_EVERY_MINUTES'] ?? '0');
  if (!Number.isFinite(minutes) || minutes <= 0 || !dbPath || dbPath === ':memory:') return;

  const every = Math.max(1, Math.floor(minutes)) * 60_000;
  timer = setInterval(() => {
    try {
      const { file, meta } = createBackup(dbPath, 'scheduled');
      const pruned = pruneBackups(dbPath);
      log(`[reepi] backup ${file} (${meta?.bytes ?? 0} bytes)${pruned.length ? `, pruned ${pruned.length}` : ''}`);
    } catch (error) {
      log(`[reepi] backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, every);
  /* Do not hold the process open for a backup. */
  timer.unref?.();
}

export function stopBackupSchedule(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
