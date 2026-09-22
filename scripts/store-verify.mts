/**
 * Throwaway: prove the store split is behaviour-preserving.
 *
 * The split moved ~1150 lines into thirteen modules behind a barrel. What matters
 * is not that it compiles — it is that every DAO still round-trips against a real
 * database, and that the cross-cutting read still assembles a whole bundle.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'reepi-store-'));
const { openDatabase, closeDatabase } = await import('../src/server/db.ts');
const {
  stories, scenes, characters, personas, lore, messages, memories, notes, threads,
  ledger, prefixes, settings, warmups, loadStoryBundle,
} = await import('../src/server/store/index.ts');

openDatabase(join(dir, 'split.sqlite'));

const checks: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => checks.push([name, ok, detail]);

// --- stories
const story = stories.create({ title: 'Split', bible: 'canon' });
check('stories.create/get', stories.get(story.id)?.title === 'Split');
check('stories.update', stories.update(story.id, { title: 'Renamed' })?.title === 'Renamed');
stories.touch(story.id);
check('stories.touch moves updatedAt', (stories.get(story.id)?.updatedAt ?? 0) > 0);

// --- scenes (with JSON state round-trip)
const scene = scenes.create(story.id, { title: 'Opening' });
scenes.update(scene.id, { state: [{ key: 'tide', value: 'rising' }] });
check('scenes JSON state round-trips', scenes.get(scene.id)?.state?.[0]?.key === 'tide');

// --- characters (meta JSON + avatar)
const chr = characters.create(story.id, { name: 'Asper', avatar: 'data:image/png;base64,AAA', meta: { tag: 'x' } });
const chrBack = characters.get(chr.id);
check('characters avatar persists', chrBack?.avatar === 'data:image/png;base64,AAA');
check('characters meta JSON persists', (chrBack?.meta as { tag?: string })?.tag === 'x');

// --- personas (the new column)
const per = personas.create(story.id, { name: 'You', avatar: 'data:image/png;base64,BBB', isDefault: true });
check('personas avatar persists', personas.get(per.id)?.avatar === 'data:image/png;base64,BBB');

// --- lore (keys serialisation)
const entry = lore.create(story.id, { title: 'Oaths', body: 'silver scars', keys: 'oath, scar' });
check('lore keys normalise', lore.get(entry.id)?.keys.includes('oath') === true);

// --- messages (auto seq + variant selection)
const m1 = messages.create({ storyId: story.id, sceneId: scene.id, role: 'user', variants: ['hello'], origin: 'user' });
const m2 = messages.create({ storyId: story.id, sceneId: scene.id, role: 'assistant', variants: ['hi', 'hey'], origin: 'narrator' });
check('messages.assigns increasing seq', m2.seq > m1.seq, `${m1.seq} -> ${m2.seq}`);
check('messages.setVariantText rewrites active variant', messages.setVariantText(m2.id, 1, 'revised')?.variants[1] === 'revised');
check('messages.update clamps activeVariant', messages.update(m2.id, { activeVariant: 99 })?.activeVariant === 1);
check('messages.assistantWords counts', messages.assistantWords(story.id) > 0);

// --- memories (FTS backfill happens on create)
memories.add({ storyId: story.id, text: 'Mira dusts the crown', subject: 'Mira', sourceMessageId: null, seq: 1, salience: 0.9, kind: 'fact' });
check('memories.list', memories.list(story.id).length === 1);

// --- notes, threads
const note = notes.add({ storyId: story.id, messageId: null, kind: 'nudge', body: 'tighten the middle', payload: null, accepted: false });
notes.setAccepted(note.id, true);
check('notes.setAccepted', notes.list(story.id)[0]?.accepted === true);
threads.upsertOpen(story.id, 'the debt', scene.id);
check('threads list', threads.list(story.id)[0]?.label === 'the debt');

// --- ledger + prefixes + settings + warmups
ledger.record({ storyId: story.id, kind: 'narration', model: 'deepseek-flash', cacheHitTokens: 10, cacheMissTokens: 2, outputTokens: 5, reasoningTokens: 0, costUsd: 0.001, savedUsd: 0.002, peak: false });
check('ledger.forStory', ledger.forStory(story.id, 10).length === 1);
prefixes.save({ fingerprint: 'fp1', storyId: story.id, tokens: 100, blockHashes: { a: 'x' }, blockTokens: { a: 1 }, messageMeta: [{ hash: 'h', tokens: 4, chars: 5 }] });
check('prefixes.latest', prefixes.latest(story.id)?.tokens === 100);
settings.set('calibration', { factor: 1.1 });
check('settings JSON round-trip', (settings.all()['calibration'] as { factor?: number })?.factor === 1.1);
warmups.save({ storyId: story.id, fingerprint: 'fp1', warmedAt: Date.now(), tokens: 100, costUsd: 0.0001 });
check('warmups.get', warmups.get(story.id)?.fingerprint === 'fp1');

// --- the cross-cutting read
const bundle = loadStoryBundle(story.id);
check('loadStoryBundle assembles every child', Boolean(
  bundle && bundle.scenes.length === 1 && bundle.characters.length === 1 &&
  bundle.personas.length === 1 && bundle.lore.length === 1 && bundle.messages.length === 2 &&
  bundle.memories.length === 1 && bundle.threads.length === 1 && bundle.notes.length === 1,
));
check('loadStoryBundle on unknown id returns null', loadStoryBundle('nope') === null);

// --- cascade delete still works through the split
stories.remove(story.id);
check('story delete cascades (foreign_keys ON)', messages.list(story.id).length === 0);

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok, detail] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

closeDatabase();
rmSync(dir, { recursive: true, force: true });
if (failed.length) process.exitCode = 1;
