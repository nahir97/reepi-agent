/**
 * Throwaway: prove the store split is behaviour-preserving.
 *
 * The split moved ~1150 lines into thirteen modules behind a barrel. What matters
 * is not that it compiles — it is that every DAO still round-trips against a real
 * database, and that the cross-cutting read still assembles a whole bundle.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'reepi-store-'));
const { openDatabase, closeDatabase, getDb } = await import('../src/server/db.ts');
const existsSyncSync = existsSync;
const writeFileSyncSync = writeFileSync;
const resolveSync = resolve;
const {
  stories, scenes, characters, cast, personas, lore, messages, memories, notes, threads,
  ledger, prefixes, settings, warmups, templates, creator, loadStoryBundle, resolvePersona,
} = await import('../src/server/store/index.ts');
const { startChat, removeStoryPreservingCast } = await import('../src/server/chats.ts');
const { recreateStoryBundle } = await import('../src/server/routes/library/bundle.ts');
const { expandMacros, macroContextOf, macroCatalogue } = await import('../src/server/macros.ts');
const { compose } = await import('../src/server/composer.ts');
const { composeTurn } = await import('../src/server/orchestrator.ts');
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

/* A card owns as many chats as the writer wants (SillyTavern's model), so a second
   start is a second conversation — seeded from the same greeting, and titled so the
   library can tell them apart. "Resume" is the most recently written one. */
const secondChat = startChat(chr.id);
check('a second start creates a second chat', secondChat.kind === 'created' && secondChat.story.id !== chat?.id);
check('the second chat is titled apart from the first', secondChat.kind === 'created' && secondChat.story.title === 'Asper (2)');
check('each chat seeds its own opening line', Boolean(
  secondChat.kind === 'created' &&
  messages.list(secondChat.story.id).length === 1 &&
  messages.list(secondChat.story.id)[0]?.variants[0] === 'Well met, stranger.',
));
check('resuming a card lands in its most recent chat', stories.chatFor(chr.id)?.id === secondChat.story.id);

let secondRow = false;
try {
  stories.create({ title: 'Second thoughts', characterId: chr.id });
  secondRow = true;
} catch {
  secondRow = false;
}
check('a character may own several chat rows', secondRow);

/* The v3 unique index is gone from a fresh file — and the migration drops it from
   an existing one (pinned against a real file in the migration section). */
const chatIndexes = (
  getDb().prepare('PRAGMA index_list(stories)').all() as { name: string }[]
).map((row) => row.name);
check('nothing forces one chat per character', !chatIndexes.includes('stories_character_id'));

const branched = chat ? recreateStoryBundle(loadStoryBundle(chat.id)!, { title: 'Asper (copy)' }) : null;
check('duplicating a chat yields a standalone story', Boolean(
  branched && branched.story.characterId === null && branched.characters.length === 1 &&
  branched.messages.length === 1,
));
check('a copy is cast in the story it was copied into', branched ? cast.listForStory(branched.story.id).length === 1 : false);

/* --- greetings: the opening line plus alternates, and choosing one ----------
 *
 * A greeting is card data (`meta.first_mes`, `meta.alternate_greetings`), so it is
 * the one authored line that becomes the transcript rather than the cast block.
 * These pin the two halves that can drift: which slot an index names, and that a
 * `meta` patch merges into the card rather than replacing it.
 */
const greetingStory = stories.create({ title: 'Greetings' });
const voiced = characters.create(greetingStory.id, {
  name: 'Vess',
  meta: {
    first_mes: 'You came back.',
    alternate_greetings: ['The door is already open.', 'You are late.'],
    tags: ['noir'],
  },
});

const chosen = startChat(voiced.id, { greeting: 1 });
check('startChat seeds the chosen alternate greeting', Boolean(
  chosen.kind === 'created' &&
  messages.list(chosen.story.id).length === 1 &&
  messages.list(chosen.story.id)[0]?.variants[0] === 'The door is already open.',
));

check('a greeting edit merges into the card meta', (() => {
  const back = characters.update(voiced.id, { meta: { first_mes: 'You came back again.' } });
  return back?.meta['first_mes'] === 'You came back again.' &&
    (back.meta['tags'] as string[])?.[0] === 'noir' &&
    Array.isArray(back.meta['alternate_greetings']);
})());

/* An index that no longer resolves falls back to the opening line rather than
   failing: the card can be edited between the picker opening and the click. */
const fallbackCard = characters.create(greetingStory.id, { name: 'Orrin', meta: { first_mes: 'Well then.' } });
const fallback = startChat(fallbackCard.id, { greeting: 9 });
check('an unresolvable greeting index falls back to the opening line', Boolean(
  fallback.kind === 'created' && messages.list(fallback.story.id)[0]?.variants[0] === 'Well then.',
));

/* The editor holds empty rows; the picker must not. A blank opening and a blank
   alternate are both dropped, so index 0 is the first line that is really there. */
const blankCard = characters.create(greetingStory.id, {
  name: 'Nix',
  meta: { first_mes: '   ', alternate_greetings: ['Only this one.', ''] },
});
const only = startChat(blankCard.id, { greeting: 0 });
check('blank greeting slots are not offered', Boolean(
  only.kind === 'created' &&
  messages.list(only.story.id).length === 1 &&
  messages.list(only.story.id)[0]?.variants[0] === 'Only this one.',
));

/* --- a regenerate is a re-sample, not a rewrite -----------------------------
 *
 * The verb excludes the message it replaces from the history and asks for the same
 * next beat a `continue` asks for. It used to send "write the next beat again,
 * differently", which made the model reason about a response it could not see and
 * paraphrase it. These pin the payload, not the wording's intent: regenerate's
 * final wire message is the continuation instruction, the replaced text is absent
 * from its history, and a plain continue still carries that text. */
if (chat) {
  const chatScene = scenes.list(chat.id)[0];
  const greeting = messages.list(chat.id)[0];
  const historyText = (payload: NonNullable<ReturnType<typeof composeTurn>>): string =>
    payload.composed.blocks.find((block) => block.kind === 'history')?.text ?? '';
  const lastWire = (payload: NonNullable<ReturnType<typeof composeTurn>>): string =>
    String(payload.messages[payload.messages.length - 1]?.content ?? '');
  const needle = (greeting?.variants[greeting.activeVariant] ?? '').slice(0, 24);
  const regen = chatScene && greeting
    ? composeTurn({ storyId: chat.id, sceneId: chatScene.id, mode: 'regenerate', messageId: greeting.id })
    : null;
  const cont = chatScene ? composeTurn({ storyId: chat.id, sceneId: chatScene.id, mode: 'continue' }) : null;

  check('regenerate sends the same instruction as a continue', Boolean(
    regen && cont && lastWire(regen) === lastWire(cont) && lastWire(regen) === 'Continue the scene directly from where it stops.',
  ));
  check('regenerate drops the message it replaces from history', Boolean(regen && needle && !historyText(regen).includes(needle)));
  check('a continue still carries it', Boolean(cont && needle && historyText(cont).includes(needle)));
}

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

/* A story owns the *link* to the prompt it was applied from; the words stay its
   own. Deleting the template must therefore leave the prose and drop the claim —
   `clearTemplate` is what the delete route runs inside its transaction. */
const prompted = stories.create({ title: 'Prompted' });
stories.update(prompted.id, { contract: 'Obey {{user}}.', templateId: template.id });
check('a story records the template it speaks in', stories.get(prompted.id)?.templateId === template.id);
stories.clearTemplate(template.id);
check('deleting a template clears the link', stories.get(prompted.id)?.templateId === null);
check('deleting a template keeps the words', stories.get(prompted.id)?.contract === 'Obey {{user}}.');

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
check('a card with no world keeps its conversation', (() => {
  /* There is no "open or create" any more: a card can own several chats, so a
     click resumes through `chatFor` rather than through `startChat`. A card whose
     world is gone must still resolve to the conversation it already has. */
  return stories.chatFor(survivor.id)?.id === survivorChat?.id;
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

/* --- library cards with no home, and the assistant's own thread --------------
   Two things this store gained: a card can exist before any story does (the
   assistant writes characters into a library that may not have a world yet), and
   the assistant's conversation is app-scoped, with each assistant row carrying the
   receipt of what that turn did. */
const floating = characters.create(null, { name: 'Homeless', description: 'written before any world' });
check('a card can be created with no home story', floating.homeStoryId === null);
check('a card with no home joins no cast', cast.all().every((row) => row.characterId !== floating.id));
check('a card with no home is still a library card', characters.list().some((card) => card.id === floating.id));
check('a card with no home carries a token weight', floating.tokens > 0);

const asked = creator.add({ role: 'user', body: 'write me a steward', allowOverwrite: true, targetStoryId: null });
creator.add({
  role: 'assistant',
  body: 'Done.',
  receipt: {
    reply: 'Done.',
    created: [{ kind: 'character', id: floating.id, name: 'Homeless', storyId: null, tokens: floating.tokens }],
    updated: [],
    replacedBlocks: [],
    refused: [],
    newStoryId: null,
    costUsd: 0.0005,
    model: 'deepseek-flash',
  },
  allowOverwrite: true,
  targetStoryId: null,
});
const thread = creator.list();
check('the assistant thread reads oldest first', thread[0]?.id === asked.id && thread[1]?.role === 'assistant');
check('the assistant thread keeps the writer consent', thread[0]?.allowOverwrite === true);
check('the assistant thread keeps the receipt', thread[1]?.receipt?.created[0]?.name === 'Homeless');
check('the receipt survives as data, not a re-derivation', thread[1]?.receipt?.costUsd === 0.0005);
check('the assistant thread is app-scoped', creator.count() === 2);
creator.clear();
check('a new chat clears the thread', creator.count() === 0);

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

/* --- backups ---------------------------------------------------------------
 *
 * The claim a backup system has to earn is not "it writes a file" — it is "the file
 * can be put back". So this snapshots a known database, destroys the thing it
 * proves, restores, and reads the proof back out of the restored file. A backup
 * suite that only checks the file exists is the failure mode worth pinning. */
const backupTarget = join(dir, 'backup.sqlite');
closeDatabase();
const { createBackup, listBackups, pruneBackups, restoreBackup, verifyBackup, backupDirFor } = await import(
  '../src/server/backup.ts'
);
openDatabase(backupTarget);
const beforeBackup = stories.create({ title: 'Inside the snapshot', bible: 'kept' });
const snapshot = createBackup(backupTarget, 'store-verify');
check('a snapshot is written', existsSyncSync(snapshot.path));
check("a snapshot passes SQLite's own integrity check", snapshot.meta?.integrity === 'ok');
check('snapshot metadata names the tables it holds', (snapshot.meta?.tables ?? []).includes('stories'));
check('snapshot metadata counts the rows', (snapshot.meta?.counts?.['stories'] ?? 0) >= 1);
check('verifyBackup accepts a good snapshot', verifyBackup(snapshot.path).ok);
check('listBackups finds it', listBackups(backupTarget).some((entry) => entry.file === snapshot.file));

/* Change the live database in the most destructive way available, then restore. */
stories.remove(beforeBackup.id);
check('the story is gone before the restore', stories.get(beforeBackup.id) === null);
closeDatabase();

const restoredResult = restoreBackup(backupTarget, snapshot.path);
openDatabase(backupTarget);
check('the restore puts the file back at the database path', restoredResult.restored === resolveSync(backupTarget) && existsSyncSync(backupTarget));
check('the displaced file is kept, not deleted', existsSyncSync(restoredResult.displaced));
check('a deleted row comes back', stories.get(beforeBackup.id)?.title === 'Inside the snapshot');
check('its columns come back too', stories.get(beforeBackup.id)?.bible === 'kept');
check(
  'the restored database has no dangling foreign keys',
  (getDb().prepare('PRAGMA foreign_key_check').all() as unknown[]).length === 0,
);
closeDatabase();

/* A corrupt file must be refused rather than restored over a working database. */
const corrupt = join(dir, 'corrupt.sqlite');
writeFileSyncSync(corrupt, 'this is not a sqlite file');
check('verifyBackup rejects a file that is not a database', verifyBackup(corrupt).ok === false);
let refused = false;
try {
  restoreBackup(backupTarget, corrupt);
} catch {
  refused = true;
}
check('restore refuses a snapshot that fails verification', refused);

/* A restore *consumes* the snapshot it restores — it moves the file into place, so
   that file is no longer a backup. That is deliberate (see the module: a restore is
   the only operation that can lose the writer's most recent work, so the snapshot
   must not be left where a second restore could silently reuse a stale copy) and it
   is why this counts from here rather than assuming the first one is still there. */
check('the restored snapshot is no longer in the backup folder', listBackups(backupTarget).length === 0);

/* Rotation never empties the folder, however small the limit. Three snapshots, a
   limit of zero: two must go and the newest must stay. */
openDatabase(backupTarget);
createBackup(backupTarget, 'second');
createBackup(backupTarget, 'third');
createBackup(backupTarget, 'fourth');
closeDatabase();
check('three snapshots exist before pruning', listBackups(backupTarget).length === 3);
const pruned = pruneBackups(backupTarget, 0);
check('prune removes the older snapshots', pruned.length === 2);
check('prune keeps the newest even at zero', listBackups(backupTarget).length === 1);
check('the backups live beside the database', backupDirFor(backupTarget).includes('backups'));

/* --- avatars ---------------------------------------------------------------
 *
 * An avatar is rendered in an `<img src>`, so a value that is not a URL is a request
 * the browser makes. The app used to store bare base64 — which made it ask for a
 * 123 kB path and fail with a 431, so every portrait set through the editor fell back
 * to initials and a character looked missing. These pin the reader that fixes that
 * and the doors that now refuse anything else.
 */
const { normalizeAvatar, isRenderableAvatar, sniffImageType } = await import('../src/server/avatars.ts');
const { sanitiseCharacter, sanitisePersona } = await import('../src/server/routes/library/sanitise.ts');

/** A minimal but *real* PNG: the magic bytes are what the type is read from. */
const pngBase64 = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
const jpegBase64 = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex').toString('base64');

check('sniffImageType reads a PNG', sniffImageType(Buffer.from(pngBase64, 'base64')) === 'image/png');
check('sniffImageType reads a JPEG', sniffImageType(Buffer.from(jpegBase64, 'base64')) === 'image/jpeg');
check('sniffImageType refuses other bytes', sniffImageType(Buffer.from('not an image at all', 'utf8')) === null);

check('a data URL is left alone', normalizeAvatar('data:image/png;base64,AAAA').value === 'data:image/png;base64,AAAA');
check('an http URL is left alone', normalizeAvatar('https://example.test/a.png').value === 'https://example.test/a.png');
check('`none` becomes null', normalizeAvatar('none').value === null);
check('null stays null', normalizeAvatar(null).value === null);

const repairedPng = normalizeAvatar(pngBase64);
check(
  'prefixless base64 is repaired into a data URL of the sniffed type',
  repairedPng.ok && repairedPng.value === `data:image/png;base64,${pngBase64}`,
  repairedPng.ok ? String(repairedPng.value).slice(0, 40) : 'refused',
);
check('and it is reported as a repair', repairedPng.ok && repairedPng.repaired === true);
const repairedJpeg = normalizeAvatar(jpegBase64);
check('a JPEG is repaired as a JPEG', repairedJpeg.ok && repairedJpeg.value?.startsWith('data:image/jpeg;base64,'));

check('base64 that is not an image is refused', normalizeAvatar('aGVsbG8gd29ybGQ=').ok === false);
check('a bare path is refused', normalizeAvatar('portrait.png').ok === false);
check('a javascript: URL is refused', normalizeAvatar('javascript:alert(1)').ok === false);
check('the repaired value renders', repairedPng.ok && repairedPng.value !== null && isRenderableAvatar(repairedPng.value));

/* The write path. A character card saved with bare base64 — which is precisely the
   shape the editor used to produce — is repaired on the way in; garbage is rejected
   rather than stored as a portrait nothing can show. */
const bareSaved = sanitiseCharacter({ name: 'A', avatar: pngBase64 });
check(
  'the character PATCH path repairs a prefixless avatar',
  bareSaved.patch.avatar === `data:image/png;base64,${pngBase64}`,
  String(bareSaved.patch.avatar).slice(0, 32),
);
check('the persona PATCH path repairs one too', sanitisePersona({ avatar: jpegBase64 }).patch.avatar?.startsWith('data:image/jpeg;base64,') === true);
check('both paths refuse a non-image avatar', sanitiseCharacter({ avatar: 'portrait.png' }).rejected.length === 1 && sanitisePersona({ avatar: 'portrait.png' }).rejected.length === 1);
check('both paths still accept null, to remove a portrait', sanitiseCharacter({ avatar: null }).patch.avatar === null && sanitisePersona({ avatar: null }).patch.avatar === null);
check('a good data URL passes through unchanged', sanitiseCharacter({ avatar: 'data:image/webp;base64,AAAA' }).patch.avatar === 'data:image/webp;base64,AAAA');

/* --- the migration guard ---------------------------------------------------
 *
 * The failure this whole module exists for: an additive migration changes the
 * schema, and the file it ran against cannot be recovered. Two things are pinned
 * here — that a pending migration is noticed *before* it runs, and that the boot
 * leaves a snapshot behind when it is.
 */
const guardTarget = join(dir, 'guard.sqlite');
{
  openDatabase(guardTarget);
  closeDatabase();

  /* Rebuild `stories` exactly as it is, minus `template_id` — "the file predates
     the column". The column list comes from PRAGMA rather than a hand-written
     CREATE, so this test cannot drift from the schema it is pretending to be old.
     Dependencies are dropped and restored because that is what a table rebuild
     costs in SQLite; the point of the test is the *boot* that follows, not this. */
  const raw = new DatabaseSync(guardTarget);
  const columns = raw.prepare('PRAGMA table_info(stories)').all() as { name: string; type: string; dflt_value: string | null; pk: number }[];
  const keep = columns.filter((column) => column.name !== 'template_id');
  raw.exec('PRAGMA foreign_keys = OFF');
  raw.exec('DROP TABLE scenes');
  raw.exec('DROP TABLE story_cast');
  raw.exec("CREATE TABLE stories_new AS SELECT 1 AS id");
  raw.exec('DROP TABLE stories_new');
  raw.exec(
    `CREATE TABLE stories_new (${keep
      .map((column) => `"${column.name}" ${column.type}${column.pk ? ' PRIMARY KEY' : ''}${column.dflt_value ? ` DEFAULT ${column.dflt_value}` : ''}`)
      .join(', ')})`,
  );
  raw.exec(`INSERT INTO stories_new SELECT ${keep.map((column) => `"${column.name}"`).join(', ')} FROM stories`);
  raw.exec('DROP TABLE stories');
  raw.exec('ALTER TABLE stories_new RENAME TO stories');
  raw.close();

  const { backupDirFor: dirOf } = await import('../src/server/backup.ts');
  rmSync(dirOf(guardTarget), { recursive: true, force: true });

  /* Booting this file must migrate it *and* leave a pre-migration snapshot. */
  openDatabase(guardTarget);
  check(
    'a pending migration is applied on boot',
    (getDb().prepare('PRAGMA table_info(stories)').all() as { name: string }[]).some(
      (column) => column.name === 'template_id',
    ),
  );
  const guardBackups = listBackups(guardTarget);
  check('the boot snapshots before migrating', guardBackups.length === 1);
  check(
    'the snapshot says why it was taken',
    (guardBackups[0]?.meta?.reason ?? '').includes('pre-migration'),
    guardBackups[0]?.meta?.reason ?? 'no reason',
  );
  check(
    'the snapshot predates the migration, so it still has the old shape',
    (() => {
      const snap = new DatabaseSync(guardBackups[0]!.path, { readOnly: true });
      const hasColumn = (snap.prepare('PRAGMA table_info(stories)').all() as { name: string }[]).some(
        (column) => column.name === 'template_id',
      );
      snap.close();
      return hasColumn === false;
    })(),
  );
  check(
    'the applied migration is recorded in the ledger',
    (getDb().prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).some((row) =>
      row.name.includes('template_id'),
    ),
  );
  closeDatabase();
}

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok, detail] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

closeDatabase();
rmSync(dir, { recursive: true, force: true });
if (failed.length) process.exitCode = 1;
