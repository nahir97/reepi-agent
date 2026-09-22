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
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'reepi-store-'));
const { openDatabase, closeDatabase, getDb } = await import('../src/server/db.ts');
const {
  stories, scenes, characters, cast, personas, lore, messages, memories, notes, threads,
  ledger, prefixes, settings, warmups, templates, loadStoryBundle, resolvePersona,
} = await import('../src/server/store/index.ts');
const { startChat, removeStoryPreservingCast } = await import('../src/server/chats.ts');
const { recreateStoryBundle } = await import('../src/server/routes/library/bundle.ts');
const { expandMacros, macroContextOf, macroCatalogue } = await import('../src/server/macros.ts');
const { compose } = await import('../src/server/composer.ts');
const { DEFAULT_CALIBRATION } = await import('../src/shared/tokens.ts');

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
check('a copy is cast in the story it was copied into', branched ? cast.listForStory(branched.story.id).length === 1 : false);

/* --- the cast is a library: one card, many casts ---------------------------
   The card keeps one definition and one home; a second story adopts it. An edit
   made anywhere is visible everywhere, which is the whole reason this is a
   reference and not a copy. */
const blank = stories.create({ title: 'Blank' });
check('a new story starts with an empty cast', cast.listForStory(blank.id).length === 0);
check('the home story casts its card', cast.listForStory(story.id).map((card) => card.id).join(',') === chr.id);

cast.add(blank.id, chr.id);
check('adopting puts the same card in a second cast', cast.listForStory(blank.id).map((card) => card.id).join(',') === chr.id);
check('adopting does not move the card', characters.get(chr.id)?.homeStoryId === story.id);
check('adopting leaves the home cast intact', cast.listForStory(story.id).length === 1);
check('adopting twice is a no-op', (() => {
  cast.add(blank.id, chr.id);
  return cast.listForStory(blank.id).length === 1;
})());
check('the library index reports both casts', cast.all().filter((entry) => entry.characterId === chr.id).length === 2);
check(
  'an edit reaches every cast the card is in',
  characters.update(chr.id, { tagline: 'adopted' })?.tagline === 'adopted' &&
    cast.listForStory(blank.id)[0]?.tagline === 'adopted',
);

/* A member adopted later appends, so the order a story shows is the order it cast
   them in — the card's own home order is not the second story's business. */
const elsewhere = stories.create({ title: 'Elsewhere' });
const second = characters.create(elsewhere.id, { name: 'Second' });
cast.add(blank.id, second.id);
check('a later cast member appends', cast.listForStory(blank.id).map((card) => card.name).join(',') === 'Asper,Second');

cast.remove(blank.id, chr.id);
check('detaching leaves the card alone', characters.get(chr.id) !== null);
check('detaching removes exactly one card', cast.listForStory(blank.id).map((card) => card.name).join(',') === 'Second');
cast.remove(blank.id, second.id);
check('detaching the last card empties the cast', cast.listForStory(blank.id).length === 0);
check('detaching does not touch the home cast', cast.listForStory(story.id).map((card) => card.id).join(',') === chr.id);

// --- prompt templates
const template = templates.create({
  name: 'House voice',
  blurb: 'A preset',
  blocks: { contract: 'Obey {{user}}.', style: 'plain' },
});
check('templates.create/get', templates.get(template.id)?.name === 'House voice');
check('templates.blocks JSON round-trips', templates.get(template.id)?.blocks.contract === 'Obey {{user}}.');
check('a stored template is never a built-in', template.builtin === false);
check(
  'templates.update replaces only what it was given',
  templates.update(template.id, { blocks: { genre: 'noir' } })?.blocks.genre === 'noir' &&
    templates.get(template.id)?.blocks.contract === undefined,
);
check('templates.list orders by sort_order', templates.list()[0]?.id === template.id);
templates.remove(template.id);
check('templates.remove', templates.get(template.id) === null);

/* A hand-edited database must degrade, not throw: `blocks` is JSON, and a key that
   is not an editable block would otherwise try to write a column that does not
   exist the moment someone applied it. */
getDb()
  .prepare('INSERT INTO prompt_templates (id, name, blurb, blocks, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
  .run('bad-blocks', 'Bad', '', 'not json', 0, 1, 1);
check('a corrupt blocks blob degrades to {}', Object.keys(templates.get('bad-blocks')?.blocks ?? {}).length === 0);
getDb()
  .prepare('UPDATE prompt_templates SET blocks = ? WHERE id = ?')
  .run(JSON.stringify({ persona: 'x', contract: 'ok' }), 'bad-blocks');
check(
  'a block that is not editable is dropped on read',
  templates.get('bad-blocks')?.blocks.persona === undefined && templates.get('bad-blocks')?.blocks.contract === 'ok',
);
templates.remove('bad-blocks');

// --- macros, resolved for a story
const macroStory = stories.create({
  title: 'Macro Hall',
  contract: 'Obey {{user}}.',
  genre: 'g',
  scenario: 'story scenario',
  bible: 'b',
  instruct: 'write {{targetWords}} words',
});
const primary = characters.create(macroStory.id, {
  name: 'Asper',
  description: 'A knife in silk.',
  personality: 'wry',
  speech: 'clipped',
  scenario: 'card role',
});
characters.create(macroStory.id, { name: 'Mira', description: 'Second card.' });
const voice = personas.create(macroStory.id, { name: 'Aleron', description: 'A tired archivist.', isDefault: true });
stories.update(macroStory.id, { personaId: voice.id, targetWords: 220 });
const macroScene = scenes.create(macroStory.id, { title: 'Opening', state: [{ key: 'Time', value: 'midnight' }] });
threads.upsertOpen(macroStory.id, 'the empty throne', macroScene.id);

const macroCtx = macroContextOf(stories.get(macroStory.id)!, macroScene, threads.list(macroStory.id));
const expand = (text: string) => expandMacros(text, macroCtx).text;

check("{{char}} is the cast's first card", expand('{{char}}') === 'Asper');
check('{{user}} is the resolved persona name', expand('{{user}}') === 'Aleron');
check('{{persona}} is the persona description', expand('{{persona}}') === 'A tired archivist.');
check('{{description}} is the card description', expand('{{description}}') === 'A knife in silk.');
check('{{personality}} and {{speech}} read the card', expand('{{personality}}/{{speech}}') === 'wry/clipped');
check(
  '{{scenario}} is the story block; {{charScenario}} is the card field',
  expand('{{scenario}}|{{charScenario}}') === 'story scenario|card role',
);
check('{{castNames}} joins the cast in order', expand('{{castNames}}') === 'Asper, Mira');
check('{{state}} renders the scene facts', expand('{{state}}') === 'Time: midnight');
check('{{threads}} renders the open threads', expand('{{threads}}').includes('the empty throne'));
check('{{targetWords}} is a bare number', expand('{{targetWords}}') === '220');
check('macro lookup ignores case and inner spacing', expand('{{ User }}') === 'Aleron');
check('an unknown macro is left verbatim', expand('{{nope}}') === '{{nope}}');
check(
  'expansion is single-pass: a substituted value is not rescanned',
  expandMacros('{{persona}}', { ...macroCtx, persona: { ...voice, description: '{{char}}' } }).text === '{{char}}',
);
check(
  'an empty value removes the token rather than leaving braces',
  expandMacros('[{{persona}}|{{user}}]', { ...macroCtx, persona: null }).text === '[|Player]',
);
check(
  'the expansion reports the names it expanded, deduplicated',
  expandMacros('{{user}} {{user}} {{char}}', macroCtx).macros.join(',') === 'user,char',
);
check(
  'the catalogue resolves every macro for a story',
  macroCatalogue(macroCtx).find((row) => row.name === 'user')?.value === 'Aleron',
);
check(
  'the catalogue without a story carries names but no values',
  macroCatalogue(null).every((row) => row.value === null) && macroCatalogue(null).length > 0,
);

/* A chat borrows its cast and its persona pool, so its macros resolve through the
   same helpers the payload uses — the greeting written at chat start and the
   payload built later cannot disagree about who the writer is. */
const macroChat = stories.create({ title: 'Asper', characterId: primary.id, personaId: voice.id });
const chatCtx = macroContextOf(macroChat, null, []);
check("a chat's {{char}} is the borrowed card", expandMacros('{{char}}', chatCtx).text === 'Asper');
check("a chat's {{castNames}} is that one card", expandMacros('{{castNames}}', chatCtx).text === 'Asper');
check(
  "a chat's {{user}} is the borrowed pool's persona",
  expandMacros('{{user}}', chatCtx).text === 'Aleron',
);
check('a chat with no scene resolves {{state}} to nothing', expandMacros('[{{state}}]', chatCtx).text === '[]');

// --- where expansion happens in the payload, and where it must not
const typed = messages.create({
  storyId: macroStory.id,
  sceneId: macroScene.id,
  role: 'user',
  variants: ['I say {{char}} out loud'],
  origin: 'user',
});
const composed = compose(
  {
    story: stories.get(macroStory.id)!,
    scene: macroScene,
    characters: cast.listForStory(macroStory.id),
    persona: voice,
    messages: [typed],
    loreHits: [],
    recall: [],
    threads: threads.list(macroStory.id),
    directorBrief: '',
    authorNote: 'note {{user}}',
    impersonateBrief: null,
    continueMode: false,
    userTurn: 'and {{user}} again',
    calibration: DEFAULT_CALIBRATION,
    includeTools: false,
    model: 'deepseek-flash',
    effort: 'none',
    maxTokens: 900,
    targetWords: 220,
    prefill: '{{char}}→',
  },
  null,
);
const composedBlock = (kind: string) => composed.plan.blocks.find((candidate) => candidate.kind === kind);
check('a directive block expands its macros', composedBlock('contract')?.preview.includes('Obey Aleron.') === true);
check('a directive block reports what it expanded', composedBlock('contract')?.macros.join(',') === 'user');
check('the author note is a block and expands', composedBlock('author-note')?.preview.includes('note Aleron') === true);
check(
  'the transcript keeps a macro typed into a message',
  composedBlock('history')?.preview.includes('{{char}} out loud') === true,
);
check('the transcript reports no expansion', (composedBlock('history')?.macros.length ?? 1) === 0);
check(
  "the writer's own turn is never rewritten",
  composed.messages[composed.messages.length - 2]?.content === 'and {{user}} again',
);
check('the prefill expands', composed.messages[composed.messages.length - 1]?.content === 'Asper→');
check(
  'a macro in a frozen block raises a cache warning',
  composed.plan.warnings.some((warning) => warning.includes('{{user}}') && warning.includes('frozen prefix')),
);

/* --- deleting a story keeps what it authored -------------------------------
   The two-hop cascade is gone on purpose. A story is a world, not a container
   for its people: the cards outlive it (`home_story_id` goes NULL), and the
   conversations built on them outlive it too, with the borrowed persona frozen
   in so `{{user}}` does not silently become "Player" on a transcript the writer
   already has. */
const doomed = stories.create({ title: 'Doomed', contract: 'Obey {{user}}.' });
scenes.create(doomed.id, { title: 'Opening' });
const doomedPersona = personas.create(doomed.id, { name: 'The Mask', description: 'A borrowed face.', isDefault: true });
stories.update(doomed.id, { personaId: doomedPersona.id });
const survivor = characters.create(doomed.id, { name: 'Survivor', meta: { first_mes: 'Still here.' } });
const traveler = characters.create(doomed.id, { name: 'Traveler' });
const survivorStart = startChat(survivor.id);
const survivorChat = survivorStart.kind === 'created' ? survivorStart.story : null;
check('a chat borrows its home persona pool', survivorChat ? resolvePersona(survivorChat)?.name === 'The Mask' : false);
check('the conversation owns no persona while its world exists', survivorChat ? personas.list(survivorChat.id).length === 0 : false);

const removed = removeStoryPreservingCast(doomed.id);
check('deleting a story reports the cards it kept', removed.cards.map((card) => card.name).sort().join(',') === 'Survivor,Traveler');
check('deleting a story reports the conversations it kept', removed.chats.map((story) => story.title).join(',') === 'Survivor');
check('the story itself is gone', stories.get(doomed.id) === null);
check('its persona pool is gone', personas.list(doomed.id).length === 0);
check('the card survived without a home', characters.get(survivor.id)?.homeStoryId === null);
check('the conversation survived with its transcript', Boolean(
  survivorChat && stories.get(survivorChat.id) !== null && messages.list(survivorChat.id).length === 1,
));
check('the conversation froze the persona it was using', Boolean(
  survivorChat && resolvePersona(survivorChat)?.name === 'The Mask' && personas.list(survivorChat.id).length === 1,
));
check('frozen text is the text that was borrowed', Boolean(
  survivorChat && resolvePersona(survivorChat)?.description === 'A borrowed face.',
));

/* A card with no home left can still be talked to — from a story that casts it,
   which is the only kind of story that can vouch for a world. */
check('a home-less card refuses to start a chat on its own', startChat(traveler.id).kind === 'orphan');
check('a story that does not cast it refuses too', startChat(traveler.id, { fromStoryId: blank.id }).kind === 'orphan');
const hostPersona = personas.create(blank.id, { name: 'Host', description: 'Borrowed on purpose.', isDefault: true });
stories.update(blank.id, { personaId: hostPersona.id });
cast.add(blank.id, traveler.id);
const adopted = startChat(traveler.id, { fromStoryId: blank.id });
const adoptedChat = adopted.kind === 'created' ? adopted.story : null;
check('a story that casts it lends its world', adopted.kind === 'created' && adoptedChat?.characterId === traveler.id);
check('the adopted conversation keeps the persona it started with', Boolean(
  adoptedChat && resolvePersona(adoptedChat)?.name === 'Host' && personas.list(adoptedChat.id).length === 1,
));
check('an existing chat is handed back even without a world', (() => {
  const again = startChat(survivor.id);
  return again.kind === 'exists' && again.story.id === survivorChat?.id;
})());

// --- deleting a story still cascades its own children
removeStoryPreservingCast(story.id);
check('story delete cascades its own rows (foreign_keys ON)', messages.list(story.id).length === 0);
check('the card outlives the story that authored it', characters.get(chr.id)?.homeStoryId === null);
check('the cast of a deleted story is gone with it', cast.listForStory(story.id).length === 0);
check('the conversation outlives its world', chat ? stories.get(chat.id) !== null : false);
check('its greeting survived the delete', chat ? messages.list(chat.id).length === 1 : false);
check('it now resolves the persona it was using, frozen in', chat ? resolvePersona(chat)?.name === per.name : false);

/* The two shapes a delete hits most often: a story whose cards have no chat, and a
   story with nothing in it at all. Both must be a clean no-op for the rescue. */
const emptyStory = stories.create({ title: 'Nothing here' });
scenes.create(emptyStory.id, { title: 'Opening' });
const emptyRemoval = removeStoryPreservingCast(emptyStory.id);
check('deleting an empty story reports nothing to keep', emptyRemoval.cards.length === 0 && emptyRemoval.chats.length === 0);
check('deleting an empty story deletes it', stories.get(emptyStory.id) === null);

const chatlessRemoval = removeStoryPreservingCast(elsewhere.id);
check('deleting a story whose cards have no chats keeps the cards', chatlessRemoval.cards.map((card) => card.name).join(',') === 'Second');
check('and those cards survive without a home', characters.get(second.id)?.homeStoryId === null);
check('and their cast row in that story is gone', cast.listForStory(elsewhere.id).length === 0);

/* --- v1 -> v2 migration -----------------------------------------------------
   The rename is the one place this release touches data that already exists, so
   it is pinned by hand: a real v1 file, opened by the real `openDatabase`. The
   value must survive, the old CASCADE column must be gone, and the home cast
   must be backfilled in the order it used to render in. */
closeDatabase();
const legacyPath = join(dir, 'legacy.sqlite');
{
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE stories (
      id TEXT PRIMARY KEY, title TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE characters (
      id               TEXT PRIMARY KEY,
      story_id         TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      tagline          TEXT NOT NULL DEFAULT '',
      description      TEXT NOT NULL DEFAULT '',
      personality      TEXT NOT NULL DEFAULT '',
      speech           TEXT NOT NULL DEFAULT '',
      scenario         TEXT NOT NULL DEFAULT '',
      example_dialogue TEXT NOT NULL DEFAULT '',
      meta             TEXT NOT NULL DEFAULT '{}',
      avatar           TEXT,
      tokens           INTEGER NOT NULL DEFAULT 0,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS characters_story ON characters(story_id, sort_order);
  `);
  legacy.prepare('INSERT INTO stories (id, title, created_at, updated_at) VALUES (?,?,?,?)').run('s1', 'World', 1, 1);
  legacy
    .prepare('INSERT INTO characters (id, story_id, name, tokens, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run('c1', 's1', 'Asper', 10, 3, 1, 1);
  legacy.close();
}
openDatabase(legacyPath);
const migrated = characters.get('c1');
check('migration keeps the home story', migrated?.homeStoryId === 's1');
check('migration keeps the card order', migrated?.order === 3);
const characterColumns = (getDb().prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map(
  (column) => column.name,
);
check('migration drops the old cascading column', !characterColumns.includes('story_id'));
check('migration makes the home nullable', characterColumns.includes('home_story_id'));
const homeFk = (getDb().prepare('PRAGMA foreign_key_list(characters)').all() as { from: string; on_delete: string }[]).find(
  (row) => row.from === 'home_story_id',
);
check('the home story no longer cascades', homeFk?.on_delete === 'SET NULL');
check('migration backfills the home cast', cast.listForStory('s1').map((card) => card.id).join(',') === 'c1');
check('migration leaves no dangling foreign keys', (getDb().prepare('PRAGMA foreign_key_check').all() as unknown[]).length === 0);

/* The migration runs on every boot, so a second one must be a no-op rather than a
   second copy of the membership or a lost home id. */
closeDatabase();
openDatabase(legacyPath);
check('re-opening the database keeps the home story', characters.get('c1')?.homeStoryId === 's1');
check('re-opening does not duplicate the membership', cast.all().filter((entry) => entry.characterId === 'c1').length === 1);
check('re-opening leaves one row in the card table', characters.list().length === 1);

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok, detail] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

closeDatabase();
rmSync(dir, { recursive: true, force: true });
if (failed.length) process.exitCode = 1;
