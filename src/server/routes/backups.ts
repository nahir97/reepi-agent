/**
 * Backups, over HTTP.
 *
 * A read-only view, plus one deliberate action. Both exist for the same reason: a
 * writer who has just lost a paragraph needs to know whether there is a snapshot to
 * go back to, and *"there is a folder on the server you can inspect with a shell"*
 * is not an answer a writer can use.
 *
 * `GET /api/backups` reports the snapshots beside the live database — when each was
 * taken, why, how big it is, whether it still passes SQLite's integrity check, and
 * the row counts it holds. It never reports a filesystem path: the client has no use
 * for one, and a path is a piece of the server this API has no business leaking.
 *
 * `POST /api/backups` takes one now, with an optional reason. It is the only write
 * here, and it is the action the CLI offers as `npm run db:backup`.
 */

import { Hono } from 'hono';
import { fail } from '../http.ts';
import { backupDirFor, createBackup, listBackups, pruneBackups, verifyBackup } from '../backup.ts';

/** Matches the server's own database path, resolved once at boot. */
let databasePath = 'data/reepi.sqlite';

/** Called by `index.ts` with the path it actually opened. */
export function useDatabase(path: string): void {
  databasePath = path;
}

type SnapshotReport = {
  file: string;
  at: string | null;
  reason: string;
  bytes: number;
  /** SQLite's own verdict on the snapshot as it stands now, not as it was written. */
  integrity: string;
  counts: Record<string, number>;
};

const mod = new Hono();

mod.get('/backups', (c) => {
  /* `?verify=all` re-checks every snapshot, which is what the CLI does. The default
     only re-checks the newest, because this endpoint backs a panel that opens on a
     settings page: a snapshot is immutable once written, so its stored verdict is
     trustworthy, and reading twelve files to answer "is there a backup" is work the
     page does not need. The newest is re-checked anyway — it is the one a writer
     would reach for, and the one most likely to have been half-copied by a disk. */
  const verifyAll = c.req.query('verify') === 'all';

  const snapshots: SnapshotReport[] = listBackups(databasePath).map((entry, index) => {
    const stored = entry.meta?.integrity ?? 'unknown';
    const check = verifyAll || index === 0 ? verifyBackup(entry.path) : null;
    return {
      file: entry.file,
      at: entry.meta?.at ?? null,
      reason: entry.meta?.reason ?? 'reason unrecorded',
      bytes: entry.meta?.bytes ?? 0,
      integrity: check ? check.detail : stored,
      counts: entry.meta?.counts ?? check?.counts ?? {},
    };
  });

  return c.json({
    /* The folder's *name*, not its path: enough to tell two deployments apart in a
       log line, nothing that maps the filesystem for a caller. */
    folder: backupDirFor(databasePath).split('/').slice(-1)[0] ?? 'backups',
    keeps: Number(process.env['REEPI_BACKUP_KEEP'] ?? 12),
    scheduledMinutes: Number(process.env['REEPI_BACKUP_EVERY_MINUTES'] ?? 0) || null,
    count: snapshots.length,
    snapshots,
  });
});

mod.post('/backups', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 120) : 'manual';

  try {
    const { file, meta } = createBackup(databasePath, reason);
    const pruned = pruneBackups(databasePath);
    return c.json({ ok: true, file, bytes: meta?.bytes ?? 0, pruned });
  } catch (error) {
    /* A backup that could not be taken is a real failure and must not look like a
       success: the whole point of the button is that the writer trusts the answer. */
    return fail(c, 500, 'Could not take a snapshot', error instanceof Error ? error.message : String(error));
  }
});

export default mod;
