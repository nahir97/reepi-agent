/**
 * One-time repair: make every stored avatar renderable.
 *
 * The app's own portrait picker used to store bare base64 — no `data:` prefix — so
 * every portrait set through the editor was written as a value the browser treats as
 * a *relative URL*. The result was a 431 for a path that was 123 kB long, a portrait
 * that silently fell back to initials, and a character the writer could not find.
 *
 * The write path is fixed (`fileToDataUrl`, and a normalising sanitiser that refuses
 * anything else). This is the other half: the rows that were already written.
 *
 *   npm run db:avatars            # report what would change
 *   npm run db:avatars -- --write # repair them
 *
 * Safe to run twice — a repaired value is already a data URL, so the second run
 * finds nothing. Refused values are reported and left alone: neither the type nor
 * the intent can be recovered from bytes that are not an image, and silently
 * deleting a writer's portrait would be a worse outcome than leaving a broken one
 * they can replace.
 */

import { resolve } from 'node:path';
import { normalizeAvatar } from '../src/server/avatars.ts';
import { closeDatabase, openDatabase } from '../src/server/db.ts';
import { getDb } from '../src/server/db.ts';

const DB_PATH = resolve(process.env['REEPI_DB'] ?? 'data/reepi.sqlite');
const write = process.argv.includes('--write');

type Table = { name: string; description: string };

/** Both tables that carry a portrait, and how the writer would recognise the row. */
const TABLES: Table[] = [
  { name: 'characters', description: 'character cards' },
  { name: 'personas', description: 'personas' },
];

function main(): void {
  openDatabase(DB_PATH);
  const db = getDb();

  let repaired = 0;
  let refused = 0;
  let alreadyFine = 0;

  for (const table of TABLES) {
    const rows = db
      .prepare(`SELECT id, name, avatar FROM "${table.name}" WHERE avatar IS NOT NULL AND avatar <> ''`)
      .all() as { id: string; name: string; avatar: string }[];

    const update = db.prepare(`UPDATE "${table.name}" SET avatar = ? WHERE id = ?`);

    for (const row of rows) {
      const verdict = normalizeAvatar(row.avatar);
      if (!verdict.ok) {
        refused += 1;
        console.log(`  REFUSE  ${table.name}  ${row.name}  — ${verdict.reason}`);
        continue;
      }
      if (!verdict.repaired) {
        alreadyFine += 1;
        /* Already a data URL or a remote URL: nothing to do. That is the normal
           state on a second run, which is what makes this idempotent. */
        continue;
      }
      repaired += 1;
      console.log(`  REPAIR  ${table.name}  ${row.name}  — ${verdict.note}, ${row.avatar.length} chars`);
      if (write) update.run(verdict.value, row.id);
    }
  }

  console.log();
  console.log(`  ${repaired} to repair · ${alreadyFine} already renderable · ${refused} refused`);
  if (repaired > 0 && !write) {
    console.log();
    console.log('  Nothing was written. Re-run with --write to apply the repairs.');
  }
  if (write && repaired > 0) {
    console.log();
    console.log('  Written. Take a snapshot if you have not already: npm run db:backup -- "after avatar repair"');
  }

  closeDatabase();
}

main();
