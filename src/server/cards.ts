/**
 * SillyTavern character-card v2 support: read a card out of a PNG, write a card
 * into a valid PNG, and map cards to and from Reepi's domain objects.
 *
 * Two properties matter here:
 *
 * 1. **Round-trip fidelity.** A card the writer imports and then exports must
 *    carry the same information. Reepi's `Character` has no column for tags,
 *    alternate greetings, creator notes or creator extensions, so those live in
 *    `Character.meta` (alongside the original card JSON) and are folded back out
 *    on export. Likewise the story-level fields a card cannot express natively
 *    ride along in `extensions.reepi`.
 *
 * 2. **No dependencies, no throw.** Cards arrive from the wider internet, so
 *    every parse path returns `null` instead of raising. PNG writing is done by
 *    hand — IHDR/IDAT/tEXt/IEND, zlib deflate for the scanlines, CRC32 computed
 *    locally — precisely so we never take a binary dependency for this.
 *
 * Card JSON is an untrusted boundary, so it is read field-by-field with `typeof`
 * checks. The four `str`/`strList`/`num`/`flag` coercions below are the single
 * place that happens, so every field of every card is normalised identically.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { alternateGreetingsOf, greetingOf } from '../shared/greetings.ts';
import { hashContent, parseKeys } from '../shared/ids.ts';
import type { Character, LoreEntry, LorePosition, Story } from '../shared/types.ts';
import { lore, messages } from './store/index.ts';

/* ------------------------------------------------------------------- types */

type Json = Record<string, unknown>;

export type CharacterBookEntry = {
  keys: string[];
  content: string;
  extensions?: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
} & Record<string, unknown>;

export type CharacterBook = {
  /** Optional: real cards in the wild omit this, and we do not invent it. */
  extensions?: Record<string, unknown>;
  entries: CharacterBookEntry[];
} & Record<string, unknown>;

export type CharacterCardData = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  tags: string[];
  extensions: Record<string, unknown>;
  character_book?: CharacterBook;
} & Record<string, unknown>;

export type CharacterCardV2 = {
  spec: 'chara_card_v2';
  spec_version: string;
  data: CharacterCardData;
} & Record<string, unknown>;

/** The parts of a `Character` a card can carry. */
export type CardCharacter = Pick<
  Character,
  | 'name'
  | 'tagline'
  | 'description'
  | 'personality'
  | 'speech'
  | 'scenario'
  | 'exampleDialogue'
  | 'meta'
  | 'avatar'
>;

/* --------------------------------------------------------------- normalise */

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function extensionsOf(source: Json): Record<string, unknown> {
  const raw = source['extensions'];
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
}

function normaliseEntry(raw: unknown, index: number): CharacterBookEntry {
  const source: Json = typeof raw === 'object' && raw !== null ? (raw as Json) : {};
  return {
    ...source,
    keys: strList(source['keys']),
    content: str(source['content']),
    enabled: flag(source['enabled'], true),
    insertion_order: num(source['insertion_order'], index),
    // Only materialised when the source had one: a key that was never there is
    // invented data, and it would survive a write/read round trip as noise.
    ...('extensions' in source ? { extensions: extensionsOf(source) } : {}),
  };
}

function normaliseBook(raw: unknown): CharacterBook | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const source = raw as Json;
  const entries = source['entries'];
  return {
    ...source,
    ...('extensions' in source ? { extensions: extensionsOf(source) } : {}),
    entries: Array.isArray(entries) ? entries.map((entry, index) => normaliseEntry(entry, index)) : [],
  };
}

/**
 * Coerce anything card-shaped into a v2 card, filling missing fields and keeping
 * every unknown key where it was (spread-then-assign preserves key order, which
 * is what makes the write/read round trip byte-stable). Returns `null` when there
 * is no usable name — a card without one is not a character.
 *
 * v1 cards (fields at the top level, no `data`) are lifted into the v2 shape
 * rather than rejected; that is how most of the older cards in the wild look.
 */
function normaliseCard(raw: unknown): CharacterCardV2 | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Json;
  const inner = source['data'];
  const nested = typeof inner === 'object' && inner !== null ? (inner as Json) : null;

  if (nested) {
    const name = str(nested['name']).trim();
    if (!name) return null;
    return {
      ...source,
      spec: 'chara_card_v2',
      spec_version: str(source['spec_version']) || '2.0',
      data: {
        ...nested,
        name,
        description: str(nested['description']),
        personality: str(nested['personality']),
        scenario: str(nested['scenario']),
        first_mes: str(nested['first_mes']),
        mes_example: str(nested['mes_example']),
        creator_notes: str(nested['creator_notes']),
        system_prompt: str(nested['system_prompt']),
        post_history_instructions: str(nested['post_history_instructions']),
        alternate_greetings: strList(nested['alternate_greetings']),
        tags: strList(nested['tags']),
        extensions: extensionsOf(nested),
        character_book: normaliseBook(nested['character_book']),
      },
    };
  }

  const name = str(source['name']).trim();
  if (!name) return null;
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      ...source,
      name,
      description: str(source['description']),
      personality: str(source['personality']),
      scenario: str(source['scenario']),
      first_mes: str(source['first_mes']),
      mes_example: str(source['mes_example']),
      creator_notes: str(source['creator_notes']),
      system_prompt: str(source['system_prompt']),
      post_history_instructions: str(source['post_history_instructions']),
      alternate_greetings: strList(source['alternate_greetings']),
      tags: strList(source['tags']),
      extensions: extensionsOf(source),
      character_book: normaliseBook(source['character_book']),
    },
  };
}

/* ----------------------------------------------------------------- parsing */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CARD_KEYWORD = 'chara';

/** Decode the card text: SillyTavern base64-encodes JSON, but plain JSON happens. */
function cardFromJson(raw: string): CharacterCardV2 | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const dataUrl = trimmed.startsWith('data:') ? trimmed.slice(trimmed.indexOf(',') + 1) : trimmed;
  const candidates = [Buffer.from(dataUrl, 'base64').toString('utf8'), trimmed];
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text.startsWith('{') && !text.startsWith('[')) continue;
    try {
      const card = normaliseCard(JSON.parse(text));
      if (card) return card;
    } catch {
      // Try the next candidate shape.
    }
  }
  return null;
}

function cardFromText(data: Buffer): CharacterCardV2 | null {
  const separator = data.indexOf(0);
  if (separator < 0) return null;
  if (data.toString('latin1', 0, separator) !== CARD_KEYWORD) return null;
  return cardFromJson(data.toString('utf8', separator + 1));
}

function cardFromCompressedText(data: Buffer): CharacterCardV2 | null {
  const separator = data.indexOf(0);
  if (separator < 0) return null;
  if (data.toString('latin1', 0, separator) !== CARD_KEYWORD) return null;
  if (data[separator + 1] !== 0) return null; // compression method 0 is the only one defined
  try {
    return cardFromJson(inflateSync(data.subarray(separator + 2)).toString('utf8'));
  } catch {
    return null;
  }
}

function cardFromInternationalText(data: Buffer): CharacterCardV2 | null {
  const separator = data.indexOf(0);
  if (separator < 0) return null;
  if (data.toString('latin1', 0, separator) !== CARD_KEYWORD) return null;

  const compressed = data[separator + 1] === 1;
  const method = data[separator + 2] ?? 0;
  const rest = data.subarray(separator + 3);
  const languageEnd = rest.indexOf(0);
  if (languageEnd < 0) return null;
  const afterLanguage = rest.subarray(languageEnd + 1);
  const translatedEnd = afterLanguage.indexOf(0);
  if (translatedEnd < 0) return null;
  const payload = afterLanguage.subarray(translatedEnd + 1);

  if (!compressed) return cardFromJson(payload.toString('utf8'));
  if (method !== 0) return null;
  try {
    return cardFromJson(inflateSync(payload).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Walk the PNG chunk stream and pull the first `chara` payload out of a tEXt,
 * zTXt or iTXt chunk. Anything malformed — bad signature, truncated chunk,
 * undecodable JSON, missing name — yields `null`. CRCs are deliberately not
 * verified on read: a card from the wild with a stale CRC is still a card.
 */
export function parseCardPng(buffer: Buffer): CharacterCardV2 | null {
  if (buffer.length < PNG_SIGNATURE.length) return null;
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) return null;
    const data = buffer.subarray(start, end);

    if (type === 'tEXt') {
      const card = cardFromText(data);
      if (card) return card;
    } else if (type === 'zTXt') {
      const card = cardFromCompressedText(data);
      if (card) return card;
    } else if (type === 'iTXt') {
      const card = cardFromInternationalText(data);
      if (card) return card;
    } else if (type === 'IEND') {
      break;
    }

    offset = end + 4;
  }
  return null;
}

/* ----------------------------------------------------------------- writing */

const CARD_SIZE = 512;

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer<ArrayBuffer> {
  const typeBytes = Buffer.from(type, 'latin1');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  typeBytes.copy(header, 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([header, data, crc]);
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const match = lightness - chroma / 2;
  const base: [number, number, number] =
    sector < 1 ? [chroma, second, 0]
    : sector < 2 ? [second, chroma, 0]
    : sector < 3 ? [0, chroma, second]
    : sector < 4 ? [0, second, chroma]
    : sector < 5 ? [second, 0, chroma]
    : [chroma, 0, second];
  return [
    Math.round((base[0] + match) * 255),
    Math.round((base[1] + match) * 255),
    Math.round((base[2] + match) * 255),
  ];
}

/**
 * One IDAT's worth of RGBA scanlines: a two-tone diagonal gradient whose hues
 * come from a hash of the name, so the same character always renders the same
 * tile. No text is drawn — there is no font here, and a half-rendered initial
 * would be worse than a clean gradient.
 */
function scanlines(name: string, size: number): Buffer {
  const digest = hashContent(name);
  const hue = Number.parseInt(digest.slice(0, 4), 16) % 360;
  const drift = Number.parseInt(digest.slice(4, 6), 16) % 72;
  const saturation = 0.34 + (Number.parseInt(digest.slice(6, 8), 16) / 255) * 0.24;
  const top = hslToRgb(hue, saturation, 0.24);
  const bottom = hslToRgb(hue + 32 + drift, Math.min(1, saturation + 0.12), 0.62);

  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter type 0 (none) is the only one we emit
    for (let x = 0; x < size; x += 1) {
      const blend = (x / (size - 1)) * 0.55 + (y / (size - 1)) * 0.45;
      const at = row + 1 + x * 4;
      raw[at] = Math.round(top[0] + (bottom[0] - top[0]) * blend);
      raw[at + 1] = Math.round(top[1] + (bottom[1] - top[1]) * blend);
      raw[at + 2] = Math.round(top[2] + (bottom[2] - top[2]) * blend);
      raw[at + 3] = 255;
    }
  }
  return raw;
}

/**
 * Build a card PNG: a fixed 512×512 RGBA tile plus a `tEXt` chunk carrying the
 * base64 card JSON. The result is re-parsed before it is returned, so a caller
 * can never hand the writer a file that Reepi itself cannot read back.
 */
export function buildCardPng(card: CharacterCardV2): Uint8Array<ArrayBuffer> {
  const normalised = normaliseCard(card);
  if (!normalised) throw new Error('A character card needs a name before it can be written.');

  const json = JSON.stringify(normalised);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(CARD_SIZE, 0);
  header.writeUInt32BE(CARD_SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter: adaptive
  header[12] = 0; // interlace: none

  const png = Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines(normalised.data.name, CARD_SIZE))),
    chunk(
      'tEXt',
      Buffer.concat([
        Buffer.from(CARD_KEYWORD, 'latin1'),
        Buffer.from([0]),
        Buffer.from(Buffer.from(json, 'utf8').toString('base64'), 'latin1'),
      ]),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  const reparsed = parseCardPng(png);
  if (!reparsed || JSON.stringify(reparsed) !== json) {
    throw new Error('Card PNG failed self-verification.');
  }
  return png;
}

/* ---------------------------------------------------------------- mapping */

const TO_BOOK_POSITION: Record<LorePosition, 'before_char' | 'after_char'> = {
  anchor: 'before_char',
  depth: 'after_char',
  before: 'before_char',
  after: 'after_char',
};

const LORE_POSITIONS: readonly LorePosition[] = ['anchor', 'depth', 'before', 'after'];

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Card → domain. The raw card rides along in `meta` so nothing is lost. */
export function cardToCharacter(card: CharacterCardV2): CardCharacter {
  const data = card.data;
  const avatar = str(data['avatar']).trim();
  return {
    name: data.name,
    // The card format has no home for a tagline or a speech-style note, so both
    // ride in flat `extensions` keys and are recovered here.
    tagline: str(data.extensions['reepi_tagline']),
    description: data.description,
    personality: data.personality,
    speech: str(data.extensions['reepi_speech']),
    scenario: data.scenario,
    exampleDialogue: data.mes_example,
    avatar: avatar && avatar !== 'none' ? avatar : null,
    meta: {
      card,
      tags: data.tags,
      alternate_greetings: data.alternate_greetings,
      creator_notes: data.creator_notes,
      system_prompt: data.system_prompt,
      post_history_instructions: data.post_history_instructions,
      creator: str(data['creator']),
      character_version: str(data['character_version']),
      extensions: data.extensions,
      // No column to hold it, but an exported card must still carry the greeting
      // that opened the story (see `characterToCard`).
      first_mes: data.first_mes,
    },
  };
}

/** Card book → lore rows, keeping Reepi-specific placement in `extensions.reepi_*`. */
export function cardToLore(card: CharacterCardV2): Partial<LoreEntry>[] {
  const book = card.data.character_book;
  if (!book) return [];
  return book.entries.map((entry) => {
    // A card from elsewhere may omit `extensions`; treat that as "no Reepi hints".
    const extensions = entry.extensions ?? {};
    const stored = extensions['reepi_position'];
    const position = typeof stored === 'string' ? LORE_POSITIONS.find((candidate) => candidate === stored) : undefined;
    return {
      title: str(entry['name']) || str(entry['comment']) || entry.keys[0] || 'Imported entry',
      body: entry.content,
      keys: entry.keys.join(', '),
      position: position ?? (entry['position'] === 'after_char' ? 'after' : 'anchor'),
      depth: num(extensions['reepi_depth'], 4),
      priority: num(extensions['reepi_priority'], entry.insertion_order),
      weight: num(extensions['reepi_weight'], 1),
      constant: flag(extensions['reepi_constant'], flag(entry['constant'], false)),
      enabled: entry.enabled,
    };
  });
}

/**
 * Domain → card. The story supplies the world-level fields the card format has
 * nowhere else to put: its bible becomes `creator_notes`, its genre the system
 * prompt, its instruction the post-history instruction, and the whole story
 * directive rides in `extensions.reepi` (which the importer reads back, so a card
 * exported here reimports with the same voice contract).
 */
export function characterToCard(character: Character, story: Story): CharacterCardV2 {
  const meta = character.meta;
  const entries: CharacterBookEntry[] = lore.list(story.id).map((entry) => ({
    keys: parseKeys(entry.keys),
    content: entry.body,
    extensions: {
      reepi_position: entry.position,
      reepi_depth: entry.depth,
      reepi_priority: entry.priority,
      reepi_weight: entry.weight,
      reepi_constant: entry.constant,
    },
    enabled: entry.enabled,
    insertion_order: entry.priority,
    name: entry.title,
    comment: entry.title,
    constant: entry.constant,
    position: TO_BOOK_POSITION[entry.position],
  }));

  // An imported card stores its greeting in `meta`; a story written here has one
  // as its opening assistant message. Either way the card must carry it, or the
  // card that goes out loses the line that opened the scene.
  const greeting = messages.list(story.id).find((message) => message.origin === 'greeting');
  const firstMes = greetingOf(character) || greeting?.variants[greeting.activeVariant] || '';

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: character.name,
      description: character.description,
      personality: character.personality,
      scenario: character.scenario || story.scenario,
      first_mes: firstMes,
      mes_example: character.exampleDialogue,
      creator_notes: metaString(meta, 'creator_notes') ?? story.bible,
      system_prompt: metaString(meta, 'system_prompt') ?? story.genre,
      post_history_instructions: metaString(meta, 'post_history_instructions') ?? story.instruct,
      // The greeting slots' single reader, so a blank row the editor is holding
      // cannot leak onto an exported card as an empty alternate.
      alternate_greetings: alternateGreetingsOf(character),
      tags: strList(meta['tags']),
      extensions: {
        ...extensionsOf(meta),
        // Card v2 has nowhere to put these two, so they ride as flat keys and are
        // read back by `cardToCharacter` — a card exported here reimports whole.
        reepi_tagline: character.tagline,
        reepi_speech: character.speech,
        reepi: {
          storyTitle: story.title,
          genre: story.genre,
          bible: story.bible,
          style: story.style,
          instruct: story.instruct,
          contract: story.contract,
          targetWords: story.targetWords,
          model: story.model,
        },
      },
      // Only written when the story has lore: an empty book is a fabricated field,
      // and it would come back as a fabricated key on reimport.
      ...(entries.length > 0
        ? {
            character_book: {
              name: `${character.name}'s world`,
              description: story.bible,
              entries,
              extensions: {},
            },
          }
        : {}),
    },
  };
}

/**
 * The story-level fields an exported card carries for a lossless reimport. A card
 * from anywhere else has no `reepi` block, so a missing key reads as empty rather
 * than as an error.
 */
export function reepiExtensionString(card: CharacterCardV2, key: string): string {
  const reepi = card.data.extensions['reepi'];
  if (typeof reepi !== 'object' || reepi === null) return '';
  return str((reepi as Record<string, unknown>)[key]);
}
