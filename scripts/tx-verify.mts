/**
 * Throwaway: prove `transaction()` is atomic.
 *
 * The claim worth testing is the rollback, not the happy path — a commit that
 * works proves nothing about what happens when the third of ten writes throws.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'reepi-tx-'));
const { openDatabase, getDb, closeDatabase, transaction } = await import(
  '../src/server/db.ts'
);
const { stories, scenes } = await import('../src/server/store/index.ts');

openDatabase(join(dir, 'tx.sqlite'));
const db = getDb();

const before = db.prepare('SELECT count(*) c FROM stories').get() as { c: number };

// 1. A throw mid-way must leave nothing behind.
let threw = false;
try {
  transaction(() => {
    stories.create({ title: 'keeper' });
    stories.create({ title: 'doomed' });
    throw new Error('simulated failure after two writes');
  });
} catch (error) {
  threw = (error as Error).message;
}

const afterRollback = db.prepare('SELECT count(*) c FROM stories').get() as { c: number };
console.log('threw:', threw);
console.log(`stories before=${before.c} after-rollback=${afterRollback.c} -> rolled back: ${afterRollback.c === before.c}`);

// 2. A clean run must commit everything.
const committed = transaction(() => {
  stories.create({ title: 'alpha' });
  stories.create({ title: 'beta' });
  return db.prepare('SELECT count(*) c FROM stories').get() as { c: number };
});
const afterCommit = db.prepare('SELECT count(*) c FROM stories').get() as { c: number };
console.log(`clean run wrote ${committed.c - before.c} rows; persisted=${afterCommit.c - before.c} -> committed: ${afterCommit.c === committed.c}`);

// 3. A nested call must fail loudly rather than silently emitting a second BEGIN.
let nested = 'no error';
try {
  transaction(() => transaction(() => stories.create({ title: 'nested' })));
} catch (error) {
  nested = (error as Error).message.slice(0, 60);
}
console.log('nested transaction ->', nested);

// 4. The real multi-table path: a story copy is all-or-nothing end to end.
const source = stories.create({ title: 'source' });
scenes.create(source.id, { title: 'Opening' });
const beforeCopy = db.prepare('SELECT count(*) c FROM stories').get() as { c: number };
const { recreateStoryBundle } = await import('../src/server/routes/library.ts');
const { loadStoryBundle } = await import('../src/server/store/index.ts');
const bundle = loadStoryBundle(source.id)!;
const copy = recreateStoryBundle(bundle, { title: 'copy' });
const copyRows = db.prepare('SELECT count(*) c FROM scenes WHERE story_id=?').get(copy.story.id) as { c: number };
const afterCopy = db.prepare('SELECT count(*) c FROM stories').get() as { c: number };
console.log(
  `copy: stories ${beforeCopy.c}->${afterCopy.c}, scenes copied=${copyRows.c}, persona linked=${Boolean(copy.story.personaId)}`,
);

closeDatabase();
rmSync(dir, { recursive: true, force: true });
