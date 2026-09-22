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
  ledger, prefixes, settings, warmups, loadStoryBundle, resolvePersona,
} = await import('../src/server/store/index.ts');
const { startChat } = await import('../src/server/chats.ts');
const { recreateStoryBundle } = await import('../src/server/routes/library/bundle.ts');

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

// --- character chats: a story with a borrowed card, and a borrowed persona pool
// A greeting lives on the card, which is where an imported card keeps `first_mes`.
characters.update(chr.id, { meta: { tag: 'x', first_mes: 'Well met, stranger.' } });

const started = startChat(chr.id);
check('startChat creates the chat', started.kind === 'created');
const chat = started.kind === 'created' ? started.story : null;
check('chat is titled for the card', chat?.title === 'Asper');
check('chat carries the character reference', chat?.characterId === chr.id);
check('chat copies the world but not the transcript', Boolean(
  chat && chat.contract === story.contract && chat.theme === story.theme && chat.model === story.model &&
  chat.instruct === '' && chat.synopsis === '',
));
check('chat seeds the card greeting', Boolean(
  chat && messages.list(chat.id).length === 1 &&
  messages.list(chat.id)[0]?.origin === 'greeting' &&
  messages.list(chat.id)[0]?.variants[0] === 'Well met, stranger.' &&
  messages.list(chat.id)[0]?.speaker === 'Asper',
));
check('chat copies anchored lore only', chat ? lore.list(chat.id).length === 1 : false);

const chatBundle = chat ? loadStoryBundle(chat.id) : null;
check('a chat borrows its cast (one card)', chatBundle?.characters.length === 1 && chatBundle?.characters[0]?.id === chr.id);
check('a chat borrows the home persona pool', chatBundle?.personas.length === 1 && chatBundle?.personas[0]?.id === per.id);
check('resolvePersona reads through the pool', chat ? resolvePersona(chat)?.id === per.id : false);
check('a chat resolves its persona even with no rows of its own', chat ? personas.list(chat.id).length === 0 : false);

const again = startChat(chr.id);
check('one chat per character', again.kind === 'exists' && again.story.id === chat?.id);

let refusedSecondChat = false;
try {
  stories.create({ title: 'Second thoughts', characterId: chr.id });
} catch {
  refusedSecondChat = true;
}
check('the unique index refuses a second chat', refusedSecondChat);

const branched = chat ? recreateStoryBundle(loadStoryBundle(chat.id)!, { title: 'Asper (copy)' }) : null;
check('duplicating a chat yields a standalone story', Boolean(
  branched && branched.story.characterId === null && branched.characters.length === 1 &&
  branched.messages.length === 1,
));

// --- cascade delete still works through the split
stories.remove(story.id);
check('story delete cascades (foreign_keys ON)', messages.list(story.id).length === 0);
// The card went with the story, so the chat that borrowed it must be gone too —
// this is a two-hop cascade (stories -> characters -> stories) and the reason
// `character_id` is a real foreign key rather than a bare id.
check('deleting the story takes the card chats with it', chat ? stories.get(chat.id) === null : false);
check('the chat turns went with it', chat ? messages.list(chat.id).length === 0 : false);

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok, detail] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

closeDatabase();
rmSync(dir, { recursive: true, force: true });
if (failed.length) process.exitCode = 1;
