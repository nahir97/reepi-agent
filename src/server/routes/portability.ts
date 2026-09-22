/**
 * Portability: get a story out, get one in.
 *
 * Three export shapes and three import shapes, chosen so that no writer is ever
 * trapped in Reepi and no writer has to start from a blank page:
 *
 * - `json` is the whole bundle, and it is the *only* lossless format — the
 *   recreation logic in `library.ts` writes it back out with fresh ids under a new
 *   story row, so an export/import round trip preserves the transcript, the cast,
 *   the lore, the memories and the directive fields (which is what lets the
 *   reimported story hit the cache on its first turn instead of re-priming
 *   everything from a cold prefix).
 * - `chara` speaks SillyTavern's card format, in both directions, via `cards.ts`.
 * - `markdown` and raw `text` are for humans, and for pasting in a transcript that
 *   came from somewhere else entirely.
 *
 * Every failure on the import side is a 400 with a `detail` naming what was wrong
 * with the payload — a card that will not decode is the writer's file being
 * unusual, not the server being broken.
 */

import { Hono } from 'hono';
import type { StoryBundle, ImportBody, ExportFormat } from '../../shared/api.ts';
import { slug } from '../../shared/text.ts';
import { DEFAULT_CONTRACT, DEFAULT_STYLE, type Message, type Scene, type Story } from '../../shared/types.ts';
import { formatPercent, formatUsd, hitRate } from '../../shared/cost.ts';
import { asString, fail, notFound } from '../http.ts';
import { ledger, loadStoryBundle, messages } from '../store/index.ts';
import {
  buildCardPng,
  cardToCharacter,
  cardToLore,
  characterToCard,
  parseCardPng,
  reepiExtensionString,
} from '../cards.ts';
import { recreateStoryBundle, type BundleSeed } from './library.ts';

const mod = new Hono();

/* ----------------------------------------------------------------- helpers */

/** Filename-safe slug, so the download lands with a name the writer recognises. */

function attachment(filename: string): Record<string, string> {
  // Quote the value: story titles contain spaces, commas and quotes.
  return { 'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"` };
}

function isBundle(value: unknown): value is StoryBundle {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const story = candidate['story'];
  return (
    typeof story === 'object' &&
    story !== null &&
    typeof (story as Record<string, unknown>)['title'] === 'string'
  );
}

/** A seed, or the reason we could not build one. */
type ParseOutcome = { ok: true; seed: BundleSeed; fallbackTitle: string } | { ok: false; detail: string };

/* -------------------------------------------------------------- markdown */

function renderMessage(message: Message, user: string, assistant: string): string {
  const body = message.variants[message.activeVariant] ?? '';
  if (!body.trim()) return '';
  const speaker =
    message.role === 'user' ? user : message.role === 'assistant' ? (message.speaker ?? assistant) : 'System';
  return `**${speaker}:**\n\n${body.trim()}`;
}

/**
 * A transcript a human would actually want to read: what it cost first, then the
 * cast, then the prose, with scene breaks and scene state kept apart from the
 * dialogue. Nothing is escaped — this is prose, and a mangled asterisk is worse
 * than a stray one.
 */
function storyToMarkdown(bundle: StoryBundle): string {
  const { story, scenes, characters, personas, messages: transcript } = bundle;
  const costs = ledger.summary(story.id, 0);
  const totals = costs.reduce(
    (accumulator, event) => ({
      costUsd: accumulator.costUsd + event.costUsd,
      cacheHitTokens: accumulator.cacheHitTokens + event.cacheHitTokens,
      cacheMissTokens: accumulator.cacheMissTokens + event.cacheMissTokens,
      outputTokens: accumulator.outputTokens + event.outputTokens,
    }),
    { costUsd: 0, cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0 },
  );
  const activePersona = personas.find((persona) => persona.id === story.personaId) ?? personas[0];
  const user = activePersona?.name || 'You';
  const assistant = characters[0]?.name || 'Narrator';

  const frontMatter = [
    '---',
    `title: ${story.title}`,
    `model: ${story.model}`,
    `cost: ${formatUsd(totals.costUsd)}`,
    `hit_rate: ${formatPercent(hitRate(totals))}`,
    `words: ${messages.assistantWords(story.id)}`,
    '---',
  ];

  const cast = characters.length
    ? characters.map((character) => {
        const lines = [`### ${character.name}`];
        if (character.tagline) lines.push(`*${character.tagline}*`);
        if (character.description) lines.push(character.description);
        if (character.personality) lines.push(`**Personality.** ${character.personality}`);
        if (character.speech) lines.push(`**Speech.** ${character.speech}`);
        return lines.join('\n\n');
      })
    : ['*(no characters yet)*'];

  // A story with no scene rows still has a transcript; render it under the title
  // rather than dropping it.
  const untitled: Scene | null =
    scenes.length === 0
      ? { id: '', storyId: story.id, title: story.title, state: [], notes: '', order: 0, archived: false, createdAt: 0, updatedAt: 0 }
      : null;
  const sections = [...scenes, ...(untitled ? [untitled] : [])].map((scene) => {
    const lines = [`## ${scene.title}`];
    if (scene.state.length > 0) {
      lines.push(scene.state.map((field) => `- **${field.key}:** ${field.value}`).join('\n'));
    }
    const body = transcript
      .filter((message) => scene.id === '' || message.sceneId === scene.id)
      .map((message) => renderMessage(message, user, assistant))
      .filter(Boolean)
      .join('\n\n');
    if (body) lines.push(body);
    return lines.join('\n\n');
  });

  const scenario = story.scenario.trim();
  const parts = [
    frontMatter.join('\n'),
    `# ${story.title}`,
    scenario,
    '## Cast',
    cast.join('\n\n'),
    sections.join('\n\n---\n\n'),
  ];
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}

/* ----------------------------------------------------------------- import */

/** Strip a `data:` URL prefix — it would poison the base64 decoder. */
function decodeBase64(data: string): Buffer {
  const comma = data.indexOf(',');
  const payload = data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data;
  return Buffer.from(payload, 'base64');
}

function parseJsonImport(data: string): ParseOutcome {
  if (!data.trim()) return { ok: false, detail: 'The JSON payload is empty.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    return { ok: false, detail: `The payload is not valid JSON: ${(error as Error).message}` };
  }

  if (!isBundle(parsed)) {
    return { ok: false, detail: 'Expected a Reepi bundle with a `story` object and a `story.title`.' };
  }
  return { ok: true, seed: parsed, fallbackTitle: parsed.story.title };
}

function parseCharaImport(data: string): ParseOutcome {
  if (!data.trim()) return { ok: false, detail: 'The card payload is empty.' };
  const card = parseCardPng(decodeBase64(data));
  if (!card) {
    return {
      ok: false,
      detail:
        'No `chara` card found in that PNG. Expected a SillyTavern v2 card in a tEXt, zTXt or iTXt chunk.',
    };
  }

  const character = cardToCharacter(card);
  const firstMes = card.data.first_mes;
  const seed: BundleSeed = {
    story: {
      title: character.name,
      scenario: character.scenario,
      // The card format has no world bible; creator notes and the system prompt
      // are the closest thing, and `extensions.reepi` carries a real one when the
      // card was exported from here.
      bible: reepiExtensionString(card, 'bible') || card.data.creator_notes || card.data.system_prompt,
      style: reepiExtensionString(card, 'style') || character.personality,
      genre: reepiExtensionString(card, 'genre'),
      instruct: reepiExtensionString(card, 'instruct'),
      contract: reepiExtensionString(card, 'contract') || DEFAULT_CONTRACT,
    },
    scenes: [{ title: 'Opening' }],
    characters: [character],
    lore: cardToLore(card),
    messages: firstMes.trim()
      ? [{ role: 'assistant' as const, origin: 'greeting' as const, speaker: character.name, variants: [firstMes] }]
      : [],
  };

  return { ok: true, seed, fallbackTitle: character.name };
}

/** Passages at least this long are read as the narrator's, not the writer's. */
const LONG_PASSAGE_WORDS = 40;

function parseTextImport(data: string): ParseOutcome {
  const chunks = data
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length === 0) return { ok: false, detail: 'The text payload has no paragraphs to import.' };

  const transcript: Partial<Message>[] = [];
  let nextRole: Message['role'] = 'user';
  for (const chunk of chunks) {
    const long = chunk.split(/\s+/u).length >= LONG_PASSAGE_WORDS;
    // Prose is the default: a long passage is the narrator speaking. Short
    // passages alternate, so a pasted back-and-forth stays a back-and-forth.
    const role: Message['role'] = long ? 'assistant' : nextRole;
    nextRole = role === 'user' ? 'assistant' : 'user';
    transcript.push({ role, origin: role === 'assistant' ? 'narrator' : 'user', variants: [chunk] });
  }

  const firstLine = chunks[0] ?? 'Imported text';
  const title = firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;

  return {
    ok: true,
    seed: {
      story: { title, contract: DEFAULT_CONTRACT, style: DEFAULT_STYLE },
      scenes: [{ title: 'Opening' }],
      messages: transcript,
    },
    fallbackTitle: title,
  };
}

/* ----------------------------------------------------------------- routes */

mod.get('/stories/:id/export', (c) => {
  const bundle = loadStoryBundle(c.req.param('id') ?? '');
  if (!bundle) return notFound(c, 'Story');

  const requested = asString(c.req.query('format'), 'json');
  const format = (['json', 'chara', 'markdown'] as const).find((candidate) => candidate === requested) as
    | ExportFormat
    | undefined;
  if (!format) {
    return fail(c, 400, 'Unsupported export format', 'Expected one of: json, chara, markdown.');
  }

  const base = slug(bundle.story.title, 'story');

  if (format === 'json') {
    return c.body(JSON.stringify(bundle, null, 2), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      ...attachment(`${base}.reepi.json`),
    });
  }

  if (format === 'chara') {
    const character = bundle.characters[0];
    if (!character) {
      return fail(c, 400, 'Nothing to export', 'A character card needs a character; this story has none yet.');
    }
    let png: Uint8Array<ArrayBuffer>;
    try {
      png = buildCardPng(characterToCard(character, bundle.story));
    } catch (error) {
      return fail(c, 400, 'Card export failed', (error as Error).message);
    }
    return c.body(png, 200, {
      'Content-Type': 'image/png',
      ...attachment(`${slug(character.name, 'character')}.card.png`),
    });
  }

  return c.body(storyToMarkdown(bundle), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    ...attachment(`${base}.md`),
  });
});

mod.post('/import', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return fail(c, 400, 'Invalid body', 'Expected a JSON object with `format` and `data`.');
  }
  if (typeof raw !== 'object' || raw === null) {
    return fail(c, 400, 'Invalid body', 'Expected a JSON object with `format` and `data`.');
  }

  const body = raw as ImportBody;
  const format = body.format;
  if (format !== 'json' && format !== 'chara' && format !== 'text') {
    return fail(c, 400, 'Unsupported import format', 'Expected one of: json, chara, text.');
  }

  const data = asString(body.data);
  if (!data) return fail(c, 400, 'Invalid body', '`data` is required.');

  const outcome =
    format === 'json' ? parseJsonImport(data)
    : format === 'chara' ? parseCharaImport(data)
    : parseTextImport(data);

  if (!outcome.ok) return fail(c, 400, 'Could not read that file', outcome.detail);

  const title = asString(body.title).trim() || outcome.fallbackTitle;
  const created = recreateStoryBundle(outcome.seed, { title });

  return c.json<Story>(created.story);
});

export default mod;
