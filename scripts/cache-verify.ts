/**
 * Live cache verification.
 *
 * This is the empirical check behind the app's central claim: that a long
 * conversation, composed the way `composer.ts` composes it, is served from
 * DeepSeek's disk cache at roughly 90% for input tokens, and that the meter's
 * prediction tracks the API's own accounting.
 *
 * It writes to a throwaway database and spends real credit — a few tenths of a
 * cent for a three-turn run on `deepseek-flash` off-peak, plus about a cent for the
 * Director pass it runs at the end to measure the shared prefix.
 *
 *   node --env-file=.env scripts/cache-verify.ts
 *
 * What to look for:
 *   - turns 2+ report a high hit rate and a lower time-to-first-token;
 *   - `predicted` and `ACTUAL` land within a few points of each other.
 *
 * Turn 1 is not guaranteed to be cold: DeepSeek keeps cache units for hours to
 * days, so if you have run this before with similar text it may already be warm.
 * Steady state is the number that matters — repeated runs settle at roughly 88%
 * of input tokens served from cache, with prediction drift under 5 points.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeDatabase, openDatabase } from '../src/server/db.ts';
import { characters, ledger, lore, messages, personas, prefixes, scenes, stories } from '../src/server/store/index.ts';
import { composePass, composeTurn, runTurn } from '../src/server/orchestrator.ts';
import { directorMode, runDirector } from '../src/server/agents.ts';
import { streamChat } from '../src/server/deepseek.ts';
import { hashContent } from '../src/shared/ids.ts';
import { estimateTokens } from '../src/shared/tokens.ts';
import { costOf, coldCostOf, formatUsd, isPeak } from '../src/shared/cost.ts';
import { DEFAULT_CONTRACT, DEFAULT_GENRE, DEFAULT_STYLE, type StreamEvent } from '../src/shared/types.ts';

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY is not set. Add it to .env or export it first.');
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'reepi-verify-'));
openDatabase(join(scratch, 'verify.sqlite'));

/* A story with a fixed payload worth caching: a contract, a world bible, two
 * cast cards and three anchored lore entries. */
const story = stories.create({
  title: 'The Hollow Court',
  contract: DEFAULT_CONTRACT,
  genre: DEFAULT_GENRE,
  style: DEFAULT_STYLE,
  scenario:
    'The court has been in mourning for a king who is not dead. Every faction knows it. Nobody says it aloud.',
  bible: Array.from(
    { length: 40 },
    (_, index) =>
      `Canon ${index}: The Hollow Court sits above the tide-bound archive. Oaths leave silver scars; a broken oath burns them black. The Ash Crown has no wearer.`,
  ).join('\n'),
  model: 'deepseek-flash',
  effort: 'none',
  temperature: 1.05,
  maxTokens: 220,
  targetWords: 120,
  loreBudget: 1200,
  historyBudget: 200_000,
});

const scene = scenes.create(story.id, { title: 'Opening' });
const persona = personas.create(story.id, {
  name: 'Wren',
  description: 'A junior archivist with a black oath-scar.',
  isDefault: true,
});
stories.update(story.id, { personaId: persona.id });

characters.create(story.id, {
  name: 'Lord Asper',
  tagline: 'Master of the tide-bound archive',
  description: 'Tall, courteous, and entirely unreadable. Keeps his gloves on indoors.',
  personality: 'Patient. Never raises his voice. Collects other people’s debts.',
  speech: 'Formal, oblique, answers questions with better questions.',
  scenario: 'He knows what happened to the crown.',
});
characters.create(story.id, {
  name: 'Mira',
  tagline: 'Oath-broker of the lower court',
  description: 'Runs the ledger of sworn words. Lies by understatement.',
  personality: 'Warm in public, precise in private.',
  speech: 'Clipped. Uses first names when she is threatening you.',
});

for (const entry of [
  ['The Silver Oath', 'A sworn word raises a silver scar on the palm. Breaking it turns the scar black, and the black never fades.'],
  ['The Tide-Bound Archive', 'A library that floods at every full moon. The lower shelves are chained.'],
  ['The Ash Crown', 'No living head has worn it. It sits on a stand that is always dusted.'],
]) {
  lore.create(story.id, {
    title: entry[0]!,
    body: entry[1]!,
    keys: 'oath, scar, crown, archive, flood, moon',
    position: 'anchor',
    constant: true,
  });
}

const TURNS = [
  'I press my palm flat against the archive door and wait for Asper to say something.',
  'I ask him, plainly, who dusts the crown.',
  'I tell him I have already sworn an oath I do not intend to keep.',
];

let worstDrift = 0;

for (const [index, turnText] of TURNS.entries()) {
  const payload = composeTurn({
    storyId: story.id,
    sceneId: scene.id,
    mode: 'send',
    text: turnText,
  });
  if (!payload) throw new Error('composeTurn returned null — the composer is broken.');

  const result = await streamChat(
    {
      messages: payload.messages,
      model: payload.model,
      effort: payload.effort,
      temperature: payload.temperature,
      topP: payload.topP,
      maxTokens: payload.maxTokens,
    },
    {},
  );

  const hit = result.usage.cacheHitTokens;
  const miss = result.usage.cacheMissTokens;
  const actualRate = hit + miss > 0 ? hit / (hit + miss) : 0;
  const predictedRate = payload.plan.predictedHitRate;
  const drift = actualRate - predictedRate;
  if (index > 0) worstDrift = Math.max(worstDrift, Math.abs(drift));

  const split = { cacheHitTokens: hit, cacheMissTokens: miss, outputTokens: result.usage.outputTokens };
  const cost = costOf(payload.model, split, isPeak());
  const cold = coldCostOf(payload.model, split, isPeak());

  console.log(`\n=== turn ${index + 1} of ${TURNS.length} ===`);
  console.log(
    `payload            ${payload.plan.totalTokens} tok in ${payload.messages.length} messages, ${payload.plan.blocks.length} blocks`,
  );
  console.log(
    `stable prefix      ${payload.plan.stablePrefixTokens} tok  (predicted hit ${(predictedRate * 100).toFixed(1)}%)`,
  );
  console.log(
    `ACTUAL usage       ${hit} hit / ${miss} miss  = ${(actualRate * 100).toFixed(1)}%   drift ${drift >= 0 ? '+' : ''}${(drift * 100).toFixed(1)}pt`,
  );
  console.log(`cost               ${formatUsd(cost)}   (cold: ${formatUsd(cold)}, saved ${formatUsd(cold - cost)})`);
  console.log(`ttft ${result.ttftMs}ms   total ${result.totalMs}ms   finish=${result.finishReason}`);

  // Persist exactly as `runTurn` does, so the next turn has a real prefix to hit.
  messages.create({ storyId: story.id, sceneId: scene.id, role: 'user', variants: [turnText], origin: 'user' });
  messages.create({
    storyId: story.id,
    sceneId: scene.id,
    role: 'assistant',
    variants: [result.text.trim() || '(empty)'],
    origin: 'narrator',
    injections: payload.plan.loreHits,
  });

  prefixes.save({
    fingerprint: payload.plan.fingerprint,
    storyId: story.id,
    tokens: payload.plan.totalTokens,
    blockHashes: Object.fromEntries(payload.composed.blocks.map((b) => [b.kind, b.hash])),
    blockTokens: Object.fromEntries(payload.composed.blocks.map((b) => [b.kind, b.tokens])),
    messageMeta: payload.messages.map((m) => {
      const content = m.content ?? '';
      return { hash: hashContent(m.role, content), tokens: estimateTokens(content) + 4, chars: content.length };
    }),
  });

  ledger.record({
    storyId: story.id,
    kind: 'narration',
    model: payload.model,
    ...split,
    reasoningTokens: result.usage.reasoningTokens,
    costUsd: cost,
    savedUsd: cold - cost,
    peak: isPeak(),
  });

  // A cache unit needs a moment to persist before the next request can hit it.
  if (index < TURNS.length - 1) {
    const pause = Promise.withResolvers<void>();
    setTimeout(pause.resolve, 3000);
    await pause.promise;
  }
}

/* --- a pass rides the turn's prefix ----------------------------------------
 *
 * The claim the pass architecture rests on: a Director call composed from the same
 * story context is served from the cache unit the narration turn just persisted,
 * rather than paying for a private context of its own. Measured, not asserted —
 * DeepSeek's own `prompt_cache_hit_tokens` is the only authority here.
 *
 * Expect a high hit rate rather than a total one. The pass's transcript is the
 * narration's plus the turn just written, so the payload diverges where that turn
 * was appended — the last turn's words, the pass's brief and its tool schemas are
 * the miss, and the whole head in front of them is the hit.
 *
 * Rounds are printed in order. Round 1 is the design claim. Later rounds are the
 * tool loop reusing *its own* unit, which is a different (and larger) saving: the API
 * persists a unit at the end of the model's output as well as at the end of the
 * input, so a round that follows another hits everything the previous round sent
 * *and* everything it generated.
 */
const passPayload = composePass({
  storyId: story.id,
  sceneId: scene.id,
  spec: directorMode(story.id),
  model: 'deepseek-flash',
  effort: 'low',
  maxTokens: 900,
});
if (!passPayload) throw new Error('composePass returned null — the pass head is broken.');

{
  const pause = Promise.withResolvers<void>();
  setTimeout(pause.resolve, 3500);
  await pause.promise;
}

const passResult = await runDirector(story.id, { messages: passPayload.messages, effort: 'low' });

const passEvents = ledger
  .forStory(story.id, 50)
  .filter((event) => event.kind === 'director')
  .sort((a, b) => a.createdAt - b.createdAt);
const passHit = passEvents.reduce((sum, event) => sum + event.cacheHitTokens, 0);
const passMiss = passEvents.reduce((sum, event) => sum + event.cacheMissTokens, 0);
const passInputCost = costOf(
  'deepseek-flash',
  { cacheHitTokens: passHit, cacheMissTokens: passMiss, outputTokens: 0 },
  isPeak(),
);
const passCold = costOf(
  'deepseek-flash',
  { cacheHitTokens: 0, cacheMissTokens: passHit + passMiss, outputTokens: 0 },
  isPeak(),
);

console.log('\n=== a pass rides the story prefix (Director) ===');
console.log(`payload            ${passPayload.plan.totalTokens} tok in ${passPayload.messages.length} messages, ${passPayload.blocks.length} blocks`);
console.log(`advertised head    ${passPayload.plan.stablePrefixTokens} tok unchanged from the narration payload`);
for (const [index, event] of passEvents.entries()) {
  const input = event.cacheHitTokens + event.cacheMissTokens;
  const rate = input > 0 ? event.cacheHitTokens / input : 0;
  console.log(
    `  round ${index + 1}          ${event.cacheHitTokens} hit / ${event.cacheMissTokens} miss = ${(rate * 100).toFixed(1)}%   ${formatUsd(event.costUsd)}${index === 0 ? '   <- riding the narration turn\'s unit' : '   <- riding the previous round'}`,
  );
}
console.log(`input cost         ${formatUsd(passInputCost)} for ${passHit + passMiss} tok   (all of it as a miss: ${formatUsd(passCold)})`);
/* The pass's actual product, printed because the payload it now reads is the whole
   story plus a brief that subordinates the narration contract — a cache win that
   quietly made the Director worse would be no win at all. */
for (const note of passResult?.notes ?? []) console.log(`  ${note.kind.padEnd(9)} ${note.body}`);
for (const update of passResult?.stateUpdates ?? []) console.log(`  state     ${update.key} = ${update.value}`);
if ((passResult?.notes.length ?? 0) === 0 && (passResult?.stateUpdates.length ?? 0) === 0) {
  console.log('  (the Director left nothing — worth a look, since the scene is mid-action)');
}

/* --- the passes a writer switches on for a turn ------------------------------
 *
 * The composer's "this turn only" panel sends `overrides.director` / `.archivist` /
 * `.conductor`, and `runTurn` runs whatever is on once the turn is written. This is
 * the only check that exercises that wiring end to end: a real turn, the real passes,
 * their real spend, and the receipts the writer's UI renders from the stream.
 */
const turnEvents: StreamEvent[] = [];
await runTurn(
  {
    storyId: story.id,
    sceneId: scene.id,
    mode: 'send',
    text: 'I ask him, plainly, whether the crown was ever worn at all.',
    overrides: { director: true, archivist: true, conductor: true, conductorVariants: 2 },
  },
  { emit: (event) => turnEvents.push(event), signal: new AbortController().signal },
);

const receipts = turnEvents.filter((event) => event.type === 'pass');
console.log('\n=== the passes switched on for a turn ===');
for (const receipt of receipts) {
  console.log(`  ${receipt.ok ? 'ok  ' : 'FAIL'} ${receipt.label.padEnd(10)} ${receipt.detail}   ${formatUsd(receipt.costUsd)}`);
}
const lastTurn = messages.list(story.id, scene.id).filter((message) => message.role === 'assistant').at(-1);
console.log(`  ${receipts.length} pass(es) ran, ${receipts.filter((r) => !r.ok).length} failed`);
console.log(`  the turn now carries ${lastTurn?.variants.length ?? 0} variant(s), #${(lastTurn?.activeVariant ?? 0) + 1} active`);
console.log(`  ledger kinds this story: ${[...new Set(ledger.forStory(story.id, 50).map((event) => event.kind))].sort().join(', ')}`);

const events = ledger.forStory(story.id, 50).filter((event) => event.kind === 'narration');
const totalHit = events.reduce((sum, event) => sum + event.cacheHitTokens, 0);
const totalMiss = events.reduce((sum, event) => sum + event.cacheMissTokens, 0);
const totalCost = events.reduce((sum, event) => sum + event.costUsd, 0);
const totalSaved = events.reduce((sum, event) => sum + event.savedUsd, 0);
const overall = totalHit + totalMiss > 0 ? totalHit / (totalHit + totalMiss) : 0;

console.log('\n=== summary ===');
console.log(`requests           ${events.length}`);
console.log(`overall hit rate   ${(overall * 100).toFixed(1)}%   (${totalHit} hit / ${totalMiss} miss)`);
console.log(`total cost         ${formatUsd(totalCost)}`);
console.log(`saved vs cold      ${formatUsd(totalSaved)}`);
console.log(`worst prediction drift ${(worstDrift * 100).toFixed(1)}pt (excluding the cold first turn)`);
console.log(`words written      ${messages.assistantWords(story.id)}`);

closeDatabase();
rmSync(scratch, { recursive: true, force: true });
