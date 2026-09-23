/**
 * Database administration: snapshot, list, verify, restore.
 *
 *   npm run db:backup  [-- keep|verify|prune] [-- "reason"]   take a snapshot now
 *   npm run db:list                                            what snapshots exist
 *   npm run db:verify                                          is the live database sound
 *   npm run db:restore -- <file>                               put a snapshot back
 *
 * **Run `npm run db:backup` before any change that can alter the schema.** The
 * server already does this for its own additive migrations (see `openDatabase`),
 * but a migration it cannot perform — dropping a constraint, changing a column's
 * type, rebuilding a table — is exactly the case that has bitten this project once.
 * SQLite cannot drop a constraint, so that repair is a `DROP`-and-`CREATE` with the
 * rows copied back, and the last line of defence is this file.
 *
 * Restores refuse to run on a snapshot that fails its own integrity check, keep the
 * file they displace, and clear the `-wal`/`-shm` beside the target. See
 * `src/server/backup.ts` for why each of those matters.
 */

import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  backupDirFor,
  createBackup,
  listBackups,
  pruneBackups,
  restoreBackup,
  verifyBackup,
} from '../src/server/backup.ts';

const DB_PATH = resolve(process.env['REEPI_DB'] ?? 'data/reepi.sqlite');

/** `--flag` style arguments that are not the first positional. */
function flags(argv: string[]): string[] {
  return argv.filter((value) => value.startsWith('--')).map((value) => value.replace(/^--/, ''));
}

function verbatimReason(argv: string[]): string {
  const bare = argv.filter((value) => !value.startsWith('--'));
  return bare.length > 0 ? bare.join(' ') : 'manual';
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function integrityOf(path: string): string {
  let handle: DatabaseSync | null = null;
  try {
    handle = new DatabaseSync(path, { readOnly: true });
    const row = handle.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
    return String(row?.quick_check ?? 'unknown');
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    handle?.close();
  }
}

/* -------------------------------------------------------------- subcommands */

function backup(argv: string[]): void {
  const reason = verbatimReason(argv);
  if (!existsSync(DB_PATH)) fail(`No database at ${DB_PATH} — nothing to snapshot.`);

  const { file, path, meta } = createBackup(DB_PATH, reason);

  if (flags(argv).includes('verify')) {
    const check = verifyBackup(path);
    if (!check.ok) fail(`Snapshot ${file} failed verification: ${check.detail}`);
  }

  const pruned = flags(argv).includes('prune') ? pruneBackups(DB_PATH) : [];
  say(`snapshot  ${file}`);
  say(`          ${meta ? bytes(meta.bytes) : '?'} · integrity ${meta?.integrity ?? '?'} · ${reason}`);
  say(`          ${backupDirFor(DB_PATH)}`);
  if (pruned.length > 0) say(`pruned    ${pruned.join(', ')}`);
  say();
  say('Restore it with:  npm run db:restore -- ' + file);
}

function list(): void {
  const entries = listBackups(DB_PATH);
  say(`database  ${DB_PATH}`);
  say(`folder    ${backupDirFor(DB_PATH)}`);
  say();

  if (entries.length === 0) {
    say('No snapshots yet. `npm run db:backup` takes one; the server also takes one');
    say('automatically before any schema migration.');
    return;
  }

  for (const entry of entries) {
    const check = verifyBackup(entry.path);
    const stamp = entry.meta?.at ?? statSync(entry.path).mtime.toISOString();
    const size = entry.meta?.bytes ?? statSync(entry.path).size;
    const counts = entry.meta?.counts ?? check.counts;
    const shape = ['stories', 'messages', 'characters']
      .filter((table) => counts[table] !== undefined)
      .map((table) => `${counts[table]} ${table}`)
      .join(', ');
    say(`${check.ok ? 'ok  ' : 'BAD '} ${entry.file}`);
    say(`      ${ageOf(stamp)} · ${bytes(size)} · ${entry.meta?.reason ?? 'reason unrecorded'}`);
    say(`      ${shape}${check.ok ? '' : `  — ${check.detail}`}`);
  }
}

function verify(argv: string[]): void {
  const named = argv.find((value) => !value.startsWith('--'));
  const path = named ? resolve(named) : DB_PATH;
  if (!existsSync(path)) fail(`No file at ${path}`);

  const integrity = integrityOf(path);
  const ok = integrity === 'ok';
  say(`${ok ? 'ok' : 'FAIL'}  ${path}`);
  say(`      integrity: ${integrity}`);

  if (ok) {
    let handle: DatabaseSync | null = null;
    try {
      handle = new DatabaseSync(path, { readOnly: true });
      const tables = (
        handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {
          name: string;
        }[]
      ).length;
      const stories = (handle.prepare('SELECT COUNT(*) n FROM stories').get() as { n: number }).n;
      const messages = (handle.prepare('SELECT COUNT(*) n FROM messages').get() as { n: number }).n;
      const fk = (handle.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
      say(`      ${tables} tables · ${stories} stories · ${messages} messages · ${fk} dangling foreign keys`);

      /* Which additive migrations this file has seen. Not read by any code path —
         it is the record that answers "did this column come in with the file or get
         added here", which is the question nothing else can answer. */
      let applied: string[] = [];
      try {
        applied = (
          handle.prepare('SELECT name FROM schema_migrations ORDER BY applied_at').all() as { name: string }[]
        ).map((row) => row.name);
      } catch {
        applied = [];
      }
      say(`      migrations: ${applied.length === 0 ? 'none recorded' : applied.join(', ')}`);
    } finally {
      handle?.close();
    }
  }

  if (!ok) process.exit(1);
}

function restore(argv: string[]): void {
  const named = argv.find((value) => !value.startsWith('--'));
  if (!named) fail('Usage: npm run db:restore -- <snapshot file or name>');
  const path = named.includes('/') ? resolve(named) : resolve(backupDirFor(DB_PATH), named);
  if (!existsSync(path)) fail(`No snapshot at ${path}`);

  const { restored, displaced } = restoreBackup(DB_PATH, path);
  say(`restored  ${basename(path)} -> ${restored}`);
  say(`kept      ${basename(displaced)}   (the database this replaced, untouched)`);
  say('note      a restore consumes its snapshot, so it is no longer in the folder.');
  say('          Take a fresh one with `npm run db:backup`.');
  say();
  say('Start the server, then `npm run db:verify` and `npm run verify:store` to confirm.');
}

/* ------------------------------------------------------------------- entry */

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'backup':
    backup(rest);
    break;
  case 'list':
    list();
    break;
  case 'verify':
    verify(rest);
    break;
  case 'restore':
    restore(rest);
    break;
  default:
    say('Usage:');
    say('  npm run db:backup  [-- verify] [-- prune] [-- "reason"]');
    say('  npm run db:list');
    say('  npm run db:verify  [-- <file>]');
    say('  npm run db:restore -- <snapshot file or name>');
    process.exit(command ? 1 : 0);
}
