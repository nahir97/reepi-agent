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
const { openDatabase, closeDatabase, getDb } = await import('../src/server/db.ts');
const {
  stories, scenes, characters, personas, lore, messages, memories, notes, threads,
  ledger, prefixes, settings, warmups, templates, loadStoryBundle, resolvePersona,
} = await import('../src/server/store/index.ts');
const { startChat } = await import('../src/server/chats.ts');
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
    characters: characters.list(macroStory.id),
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
