/**
 * The creation assistant.
 *
 * The Director keeps a scene honest; this pass writes *world material* —
 * characters, lorebooks, the story's own blocks, reusable prompt templates, and
 * whole stories. It is another side-channel pass and follows the same law as the
 * rest of `src/server/agents/`: its tools never touch the narration request, and
 * its spend is recorded under its own `CostEventKind`. That rule lives in
 * `./index.ts` and in
 * `.agents/notes/implemented/architecture/2026-09-22-narration-carries-no-tools.md`;
 * this module is a consumer of it, not a second opinion about it.
 *
 * Three properties here are deliberate and non-obvious.
 *
 * 1. **Nothing is written until the loop stops.** Every tool call stages a draft
 *    and returns a short outcome string; the drafts are applied in ONE
 *    `transaction()` at the end. That is the only shape in which a story and the
 *    cast it was born with can be one unit of work — `transaction()` is not
 *    re-entrant — and it is what makes a failed apply leave no half-built world
 *    behind.
 *
 * 2. **A block that already has text is not replaceable without an explicit,
 *    per-request flag.** The prompt asks the model to respect the writer's prose;
 *    the flag is what *makes* it, because a rule the model can be talked out of is
 *    not a rule. Replacing a block re-prices the cache prefix from that block
 *    onward, and the writer's authored prose is the one thing here a bad
 *    generation could destroy.
 *
 * 3. **The receipt is part of the return type.** A turn that moves a frozen block
 *    must say so, and a turn that refused something must say why — the writer has
 *    to be able to see the cost of what just happened without reading a log.
 */

import {
  DEFAULT_CONTRACT,
  DEFAULT_STYLE,
  EDITABLE_BLOCKS,
  EDITABLE_BLOCK_FIELD,
  isEditableBlock,
} from '../../shared/types.ts';
import { MACROS } from '../../shared/macros.ts';
import type {
  Character,
  CostEventKind,
  EditableBlock,
  LoreEntry,
  ModelId,
  ReasoningEffort,
  Story,
} from '../../shared/types.ts';
import type { CreatorCreated, CreatorRequest, CreatorResult, CreatorUpdate } from '../../shared/api.ts';
import { completeChat, type WireMessage, type WireTool } from '../deepseek.ts';
import { cast as castDao, castOf, characters, lore, stories, templates } from '../store/index.ts';
import { BUILTIN_TEMPLATES } from '../templates.ts';
import { transaction } from '../db.ts';
import { recordSideCall } from './context.ts';
/* The story-graph writer lives in the library module because import and
   duplication own it. It is imported directly rather than through the routes
   barrel so this module never pulls in an HTTP handler. */
import { writeStoryBundle, type BundleSeed } from '../routes/library/bundle.ts';

const COST_KIND: CostEventKind = 'creator';

/** Hard caps. A creation request is bounded work, and a model cannot raise them. */
export const CREATOR_LIMITS = {
  rounds: 6,
  objects: 24,
  characters: 12,
  loreEntries: 20,
  templates: 6,
  blockChars: 8_000,
  fieldChars: 2_000,
  loreBodyChars: 4_000,
  requestChars: 2_000,
  historyItems: 12,
  historyChars: 2_000,
  /** Bodies carried in the brief, so a revision has something to revise. */
  briefLoreBodies: 20,
  briefBlockChars: 1_200,
  briefLibraryCards: 60,
} as const;

/* ------------------------------------------------------------------- prompt */

export const CREATOR_SYSTEM = `You are the creation assistant inside Reepi, a writing studio for roleplay and long-form fiction.

Your job is to build world material on request: characters, lorebook entries, the story's directive blocks (scenario, story bible, genre, style, exemplars, contract, instruction), reusable prompt templates, and occasionally a whole new story. The writer keeps the prose; you supply the scaffolding it is written from.

Rules:
- Never write fiction. No scene prose, no dialogue, no narration. You produce descriptions, facts, lore and directives.
- Never write the writer's persona. Personas are theirs alone and no tool here can touch one.
- Call the tools you need, then stop. Do not narrate the calls; the studio shows the writer what you made.
- Prefer writing several things over writing one, when the request is plural. Several tool calls in one round are fine.
- Never invent a name that already exists. If a character or entry is already there, update it instead of creating a second one.
- Lorebook entries are for the *world*, not the plot: places, factions, objects, customs, history. Keep each one tight, concrete, and about 40-150 words.
- Use only the macros listed as available. Do not invent macro names.
- Match the voice of the material already in the story. If the story has a tone, it is a constraint, not a suggestion.
- You cannot rewrite a directive block that already contains text unless the brief says the writer enabled rewriting. If a tool refuses, say so plainly in your reply and move on.
- If the request is ambiguous in a way that changes what you would write — the number of characters, the genre, who the story is about — ask one short question in your reply and call no tools.

Finish with two or three sentences for the writer: what you made, in their terms, and anything you could not do. No lists, no preamble, no apology.`;

/** The tools. Every schema is closed, so the model cannot smuggle extra keys. */
export const CREATOR_TOOLS: WireTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_story',
      description:
        'Start a brand-new story from a pitch. Creates the story row with its directive blocks, an opening scene and a default persona. Use this when the writer asks for a new story, or when there is no story open at all. Everything else you write in the same turn belongs to the story you create.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The story’s title.' },
          genre: { type: 'string', description: 'Genre and tone directive.' },
          scenario: { type: 'string', description: 'The situation the story opens into.' },
          bible: { type: 'string', description: 'The world bible: facts, places, rules, history.' },
          style: { type: 'string', description: 'Prose style directive.' },
          contract: { type: 'string', description: 'Voice and format contract for the narrator.' },
          exemplars: { type: 'string', description: 'Example passages to imitate.' },
          instruct: { type: 'string', description: 'Post-history instruction for the narrator.' },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_character',
      description:
        'Write a new character card and cast it in this story. Cards are library objects: this one is authored by, and cast in, the target story. Write fields a narrator could act on — behaviour and voice, not vibes.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Their name.' },
          tagline: { type: 'string', description: 'One short line shown on the card.' },
          description: { type: 'string', description: 'Who they are: role, history, situation.' },
          personality: { type: 'string', description: 'How they behave, want, and decide.' },
          speech: { type: 'string', description: 'Speech habits, register, verbal tics.' },
          scenario: { type: 'string', description: 'Their own situation, when it differs from the story’s.' },
          example_dialogue: { type: 'string', description: 'Two to six example lines, one speaker turn each.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_character',
      description:
        'Revise a character already cast in this story. Match by their exact current name; only the fields you name are changed.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The card’s current name.' },
          rename_to: { type: 'string', description: 'Set only to rename them.' },
          tagline: { type: 'string' },
          description: { type: 'string' },
          personality: { type: 'string' },
          speech: { type: 'string' },
          scenario: { type: 'string' },
          example_dialogue: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cast_character',
      description:
        'Bring a character that already exists in the library into this story’s cast, without rewriting them. Use this instead of create_character when the brief lists someone who fits.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Their exact name in the library.' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_lore_entry',
      description:
        'File one lorebook entry. Entries are injected into a turn when their trigger keys appear, so keys are what make an entry reachable. Use `constant` only for a fact that must always be present.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name for the entry.' },
          body: { type: 'string', description: 'The fact itself, 40-150 words.' },
          keys: { type: 'string', description: 'Comma-separated trigger words.' },
          position: { type: 'string', enum: ['anchor', 'depth', 'before', 'after'] },
          constant: { type: 'boolean', description: 'Always inject this entry when the budget allows.' },
          depth: { type: 'integer', description: 'Turns from the end when position is "depth".' },
          priority: { type: 'integer', description: 'Order within a position; lower first.' },
        },
        required: ['title', 'body'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_lore_entry',
      description:
        'Revise an existing lorebook entry. Match by its exact current title; only the fields you name are changed.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The entry’s current title.' },
          new_title: { type: 'string' },
          body: { type: 'string' },
          keys: { type: 'string' },
          position: { type: 'string', enum: ['anchor', 'depth', 'before', 'after'] },
          constant: { type: 'boolean' },
          depth: { type: 'integer' },
          priority: { type: 'integer' },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_story_block',
      description:
        'Write one of the story’s directive blocks. Empty blocks are written directly; a block that already contains text is refused unless the brief says rewriting is enabled.',
      parameters: {
        type: 'object',
        properties: {
          block: {
            type: 'string',
            enum: [...EDITABLE_BLOCKS],
            description:
              'story = the long-form world bible; scenario = the situation; genre = tone; style = prose; exemplars = passages to imitate; contract = narrator rules; instruct = post-history instruction.',
          },
          text: { type: 'string', description: 'The block text, complete as written.' },
        },
        required: ['block', 'text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_template',
      description:
        'Save a reusable prompt template to the writer’s library. Templates are app-scoped and can be applied to any story, so they must not name a specific story’s characters. They may contain the story’s macros.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          blurb: { type: 'string', description: 'One line describing when to reach for it.' },
          blocks: {
            type: 'object',
            description: 'Which directive blocks it fills. At least one non-empty entry.',
            properties: Object.fromEntries(EDITABLE_BLOCKS.map((block) => [block, { type: 'string' }])),
            additionalProperties: false,
          },
        },
        required: ['name', 'blocks'],
        additionalProperties: false,
      },
    },
  },
];

/* ------------------------------------------------------------------ staging */

/** One unit of work the loop staged; applied together, or not at all. */
export type CreatorDraft =
  | { kind: 'story'; seed: BundleSeed }
  | { kind: 'character'; fields: Partial<Character> }
  | { kind: 'update-character'; match: string; fields: Partial<Character> }
  | { kind: 'cast-character'; match: string }
  | { kind: 'lore'; fields: Partial<LoreEntry> }
  | { kind: 'update-lore'; match: string; fields: Partial<LoreEntry> }
  | { kind: 'block'; block: EditableBlock; text: string }
  | {
      kind: 'template';
      fields: { name: string; blurb: string; blocks: Partial<Record<EditableBlock, string>> };
    };

/** What the loop knows about the world before it starts, kept current as it stages. */
export type CreatorState = {
  story: Story | null;
  allowOverwrite: boolean;
  /** Lowercased name → the card, for the cast of the target story. */
  castByName: Map<string, Character>;
  /** Lowercased title → the entry, in the target story. */
  loreByTitle: Map<string, LoreEntry>;
  /** Lowercased name → every card in the library with that name. */
  libraryByName: Map<string, Character[]>;
  /** Lowercased names, for the duplicate check. */
  templateNames: Set<string>;
  /** Template names as written, for the brief. */
  templateLabels: string[];
  /** Non-empty editable blocks of the target story, so the guard is answerable. */
  writtenBlocks: Set<EditableBlock>;
};

/** The mutable collections one loop drains into. */
export type CreatorSink = {
  drafts: CreatorDraft[];
  refused: { target: string; reason: string }[];
  replacedBlocks: EditableBlock[];
  reply: string;
};

export function emptySink(): CreatorSink {
  return { drafts: [], refused: [], replacedBlocks: [], reply: '' };
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

/** Pull the named string args into a patch, dropping empty ones. */
function fieldsOf<T extends object>(
  args: Record<string, unknown>,
  map: Record<string, keyof T & string>,
): Partial<T> {
  const out: Record<string, string> = {};
  for (const [arg, field] of Object.entries(map)) {
    const value = text(args[arg]);
    if (value) out[field] = value;
  }
  return out as Partial<T>;
}

const POSITIONS = ['anchor', 'depth', 'before', 'after'] as const;
type LorePosition = (typeof POSITIONS)[number];

const positionOf = (value: unknown): LorePosition | null =>
  POSITIONS.find((candidate) => candidate === text(value)) ?? null;

/* ------------------------------------------------------------ tool dispatch */

/**
 * Apply one tool call to the sink. Never throws and never writes: a bad argument
 * becomes a readable `error:` string the model can recover from on its next round,
 * exactly like `applyDirectorTool`.
 *
 * Returns the outcome string for the `tool` message; anything the writer needs to
 * know about is recorded in `sink.refused` at the same time.
 */
export function applyCreatorTool(
  name: string,
  args: Record<string, unknown>,
  sink: CreatorSink,
  state: CreatorState,
): string {
  const refuse = (target: string, reason: string): string => {
    sink.refused.push({ target, reason });
    return `error: ${reason}`;
  };

  const count = (kind: CreatorDraft['kind']): number =>
    sink.drafts.filter((draft) => draft.kind === kind).length;
  const objectCount = (): number => sink.drafts.filter((draft) => draft.kind !== 'block').length;

  if (name === 'create_story') {
    if (count('story') > 0) return refuse('story', 'a story was already created in this turn');
    const title = text(args['title']);
    if (!title) return 'error: title is required';
    if (title.length > CREATOR_LIMITS.fieldChars) return 'error: title is too long';
    const seed: BundleSeed = {
      story: {
        title,
        genre: text(args['genre']),
        scenario: text(args['scenario']),
        bible: text(args['bible']),
        style: text(args['style']) || DEFAULT_STYLE,
        contract: text(args['contract']) || DEFAULT_CONTRACT,
        exemplars: text(args['exemplars']),
        instruct: text(args['instruct']),
      },
    };
    sink.drafts.push({ kind: 'story', seed });
    return `story staged: ${title}`;
  }

  /* Everything below needs somewhere to land. A story created in this same turn
     counts — that is what makes "start a story and cast it" one request. */
  const storyPending = count('story') > 0;
  if (state.story === null && !storyPending) {
    return refuse(name, 'no story is open — create one with create_story first, or open a story');
  }

  /* A chat's cast is its `character_id`, by construction — one borrowed card. A
     new card written here would be a character the composer never reads: an
     invisible orphan that looks like a successful save. This is the same refusal
     the library route gives, for the same reason. */
  if (state.story?.characterId && (name === 'create_character' || name === 'cast_character')) {
    return refuse(name, 'this is a 1:1 chat, which has exactly one character — edit that card, or start a chat from another one');
  }

  if (name === 'create_character') {
    const card = fieldsOf<Character>(args, {
      name: 'name',
      tagline: 'tagline',
      description: 'description',
      personality: 'personality',
      speech: 'speech',
      scenario: 'scenario',
      example_dialogue: 'exampleDialogue',
    });
    const cardName = card.name ?? '';
    if (!cardName) return 'error: name is required';
    if (Object.values(card).some((value) => typeof value === 'string' && value.length > CREATOR_LIMITS.fieldChars)) {
      return 'error: one of the fields is too long';
    }
    if (count('character') >= CREATOR_LIMITS.characters) {
      return refuse(cardName, `this turn already wrote ${CREATOR_LIMITS.characters} characters`);
    }
    if (objectCount() >= CREATOR_LIMITS.objects) return refuse(cardName, 'this turn is at its object limit');
    const key = cardName.toLowerCase();
    if (state.castByName.has(key)) {
      return refuse(cardName, `a character named ${cardName} is already cast in this story — use update_character`);
    }
    sink.drafts.push({ kind: 'character', fields: card });
    state.castByName.set(key, { name: cardName } as Character);
    return `character staged: ${cardName}`;
  }

  if (name === 'update_character') {
    const wanted = text(args['name']);
    const match = wanted.toLowerCase();
    if (!match) return 'error: name is required';
    const fields = fieldsOf<Character>(args, {
      rename_to: 'name',
      tagline: 'tagline',
      description: 'description',
      personality: 'personality',
      speech: 'speech',
      scenario: 'scenario',
      example_dialogue: 'exampleDialogue',
    });
    if (Object.keys(fields).length === 0) return 'error: name at least one field to change';
    const staged = sink.drafts.find(
      (draft): draft is Extract<CreatorDraft, { kind: 'character' }> =>
        draft.kind === 'character' && (draft.fields.name ?? '').toLowerCase() === match,
    );
    if (staged) {
      /* Revising what this same turn staged: no second row, no ambiguity. */
      Object.assign(staged.fields, fields);
      return `character revised in this turn: ${wanted}`;
    }
    if (!state.castByName.has(match)) {
      return refuse(wanted, `no character named ${wanted} is cast in this story`);
    }
    sink.drafts.push({ kind: 'update-character', match, fields });
    return `character staged for revision: ${wanted}`;
  }

  if (name === 'cast_character') {
    const wanted = text(args['name']);
    if (!wanted) return 'error: name is required';
    const key = wanted.toLowerCase();
    if (state.castByName.has(key)) return `already cast: ${wanted}`;
    const candidates = state.libraryByName.get(key) ?? [];
    if (candidates.length === 0) {
      return refuse(wanted, `no character named ${wanted} exists in the library — write them with create_character`);
    }
    if (candidates.length > 1) {
      return refuse(wanted, `${candidates.length} characters are named ${wanted}; the writer must pick one by hand`);
    }
    const card = candidates[0] as Character;
    sink.drafts.push({ kind: 'cast-character', match: key });
    state.castByName.set(key, card);
    return `staged for the cast: ${card.name}`;
  }

  if (name === 'create_lore_entry') {
    const base = fieldsOf<LoreEntry>(args, { title: 'title', keys: 'keys' });
    const body = text(args['body']);
    const title = base.title ?? '';
    if (!title || !body) return 'error: title and body are required';
    if (body.length > CREATOR_LIMITS.loreBodyChars) {
      return `error: body is too long — keep entries under ${CREATOR_LIMITS.loreBodyChars} characters`;
    }
    if (count('lore') >= CREATOR_LIMITS.loreEntries) {
      return refuse(title, `this turn already filed ${CREATOR_LIMITS.loreEntries} lore entries`);
    }
    if (objectCount() >= CREATOR_LIMITS.objects) return refuse(title, 'this turn is at its object limit');
    if (state.loreByTitle.has(title.toLowerCase())) {
      return refuse(title, `a lore entry titled “${title}” already exists — use update_lore_entry`);
    }
    const position = positionOf(args['position']);
    const fields: Partial<LoreEntry> = {
      ...base,
      body,
      ...(position ? { position } : {}),
      ...(typeof args['constant'] === 'boolean' ? { constant: args['constant'] } : {}),
      ...(Number.isInteger(args['depth']) ? { depth: args['depth'] as number } : {}),
      ...(Number.isInteger(args['priority']) ? { priority: args['priority'] as number } : {}),
    };
    sink.drafts.push({ kind: 'lore', fields });
    state.loreByTitle.set(title.toLowerCase(), { title } as LoreEntry);
    return `lore staged: ${title}`;
  }

  if (name === 'update_lore_entry') {
    const wanted = text(args['title']);
    const match = wanted.toLowerCase();
    if (!match) return 'error: title is required';
    const position = positionOf(args['position']);
    const entry: Partial<LoreEntry> = {
      ...fieldsOf<LoreEntry>(args, { new_title: 'title', body: 'body', keys: 'keys' }),
      ...(position ? { position } : {}),
      ...(typeof args['constant'] === 'boolean' ? { constant: args['constant'] } : {}),
      ...(Number.isInteger(args['depth']) ? { depth: args['depth'] as number } : {}),
      ...(Number.isInteger(args['priority']) ? { priority: args['priority'] as number } : {}),
    };
    if (Object.keys(entry).length === 0) return 'error: name at least one field to change';
    const staged = sink.drafts.find(
      (draft): draft is Extract<CreatorDraft, { kind: 'lore' }> =>
        draft.kind === 'lore' && (draft.fields.title ?? '').toLowerCase() === match,
    );
    if (staged) {
      Object.assign(staged.fields, entry);
      return `lore entry revised in this turn: ${wanted}`;
    }
    if (!state.loreByTitle.has(match)) {
      return refuse(wanted, `no lore entry titled “${wanted}” exists`);
    }
    sink.drafts.push({ kind: 'update-lore', match, fields: entry });
    return `lore staged for revision: ${wanted}`;
  }

  if (name === 'set_story_block') {
    const block = text(args['block']);
    const body = text(args['text']);
    if (!isEditableBlock(block)) return `error: unknown block ${block || '(missing)'}`;
    if (!body) return 'error: text is required';
    if (body.length > CREATOR_LIMITS.blockChars) {
      return `error: text is too long — keep a block under ${CREATOR_LIMITS.blockChars} characters`;
    }

    const staged = sink.drafts.find(
      (draft): draft is Extract<CreatorDraft, { kind: 'block' }> =>
        draft.kind === 'block' && draft.block === block,
    );
    const alreadyWritten = state.writtenBlocks.has(block);
    const current = staged?.text ?? (state.story ? (state.story[EDITABLE_BLOCK_FIELD[block]] as string) : '');

    if (current.trim() === body) return `${block} unchanged`;

    if (alreadyWritten && !staged && !state.allowOverwrite) {
      return refuse(block, `the ${block} block already has text and rewriting is not enabled for this request`);
    }

    if (staged) staged.text = body;
    else sink.drafts.push({ kind: 'block', block, text: body });
    state.writtenBlocks.add(block);
    if (alreadyWritten && !sink.replacedBlocks.includes(block)) sink.replacedBlocks.push(block);
    return `${block} staged${alreadyWritten ? ' (replacing existing text)' : ''}`;
  }

  if (name === 'create_template') {
    const templateName = text(args['name']);
    if (!templateName) return 'error: name is required';
    if (count('template') >= CREATOR_LIMITS.templates) {
      return refuse(templateName, `this turn already wrote ${CREATOR_LIMITS.templates} templates`);
    }
    if (objectCount() >= CREATOR_LIMITS.objects) return refuse(templateName, 'this turn is at its object limit');
    if (state.templateNames.has(templateName.toLowerCase())) {
      return refuse(templateName, `a template named “${templateName}” already exists`);
    }
    const raw = args['blocks'];
    if (typeof raw !== 'object' || raw === null) return 'error: blocks is required';
    const blocks: Partial<Record<EditableBlock, string>> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!isEditableBlock(key)) return `error: unknown block ${key} in a template`;
      const blockText = text(value);
      if (!blockText) continue;
      if (blockText.length > CREATOR_LIMITS.blockChars) return 'error: a template block is too long';
      blocks[key] = blockText;
    }
    if (Object.keys(blocks).length === 0) return 'error: a template needs at least one non-empty block';
    sink.drafts.push({ kind: 'template', fields: { name: templateName, blurb: text(args['blurb']), blocks } });
    state.templateNames.add(templateName.toLowerCase());
    state.templateLabels.push(templateName);
    return `template staged: ${templateName}`;
  }

  return `error: unknown tool ${name}`;
}

/* -------------------------------------------------------------------- apply */

/**
 * Write the staged drafts. One transaction per turn: a story and its cast commit
 * together or not at all, and nothing here can half-exist.
 *
 * Creates run before revisions so a name staged earlier in the same turn is
 * resolvable, and every block write collapses into a single story PATCH — one
 * `updated_at` bump for the turn rather than one per block.
 */
export function applyCreatorDrafts(
  drafts: readonly CreatorDraft[],
  targetStoryId: string | null,
): { created: CreatorCreated[]; updated: CreatorUpdate[]; newStoryId: string | null } {
  return transaction(() => {
    const created: CreatorCreated[] = [];
    const updated: CreatorUpdate[] = [];

    const storyDraft = drafts.find(
      (draft): draft is Extract<CreatorDraft, { kind: 'story' }> => draft.kind === 'story',
    );
    let storyId = targetStoryId;
    let newStoryId: string | null = null;

    if (storyDraft) {
      const bundle = writeStoryBundle(storyDraft.seed, {});
      storyId = bundle.story.id;
      newStoryId = bundle.story.id;
      created.push({ kind: 'story', id: bundle.story.id, name: bundle.story.title, storyId: bundle.story.id });
    }

    /* Creates first. */
    const characterIds = new Map<string, string>();
    for (const draft of drafts) {
      if (draft.kind !== 'character' || !storyId) continue;
      const card = characters.create(storyId, draft.fields);
      characterIds.set(card.name.toLowerCase(), card.id);
      created.push({ kind: 'character', id: card.id, name: card.name, storyId, tokens: card.tokens });
    }

    const loreIds = new Map<string, string>();
    for (const draft of drafts) {
      if (draft.kind !== 'lore' || !storyId) continue;
      const entry = lore.create(storyId, draft.fields);
      loreIds.set(entry.title.toLowerCase(), entry.id);
      created.push({ kind: 'lore', id: entry.id, name: entry.title, storyId, tokens: entry.tokens });
    }

    /* Revisions, adoptions and templates. */
    for (const draft of drafts) {
      if (draft.kind === 'update-character') {
        const id = characterIds.get(draft.match) ?? castIdByName(storyId, draft.match);
        if (!id) continue;
        const card = characters.update(id, draft.fields);
        if (card) updated.push({ kind: 'character', name: card.name, fields: Object.keys(draft.fields) });
      } else if (draft.kind === 'update-lore') {
        const id = loreIds.get(draft.match) ?? loreIdByTitle(storyId, draft.match);
        if (!id) continue;
        const entry = lore.update(id, draft.fields);
        if (entry) updated.push({ kind: 'lore', name: entry.title, fields: Object.keys(draft.fields) });
      } else if (draft.kind === 'cast-character' && storyId) {
        const card = libraryCardByName(draft.match);
        if (card && !castDao.has(storyId, card.id)) {
          castDao.add(storyId, card.id);
          /* An adoption is a write to this story's prefix like any other, so it is
             reported like any other. Silence here was a real gap: a turn could add
             three borrowed cards and the receipt would say nothing. */
          created.push({ kind: 'cast', id: card.id, name: card.name, storyId, tokens: card.tokens });
        }
      } else if (draft.kind === 'template') {
        const row = templates.create(draft.fields);
        created.push({ kind: 'template', id: row.id, name: row.name, storyId: null });
      }
    }

    /* Every block this turn wrote, in one PATCH. */
    const patch: Partial<Story> = {};
    const written: { block: EditableBlock; field: string }[] = [];
    for (const draft of drafts) {
      if (draft.kind !== 'block') continue;
      const field = EDITABLE_BLOCK_FIELD[draft.block];
      patch[field] = draft.text;
      written.push({ block: draft.block, field });
    }
    if (storyId && written.length > 0) {
      stories.update(storyId, patch);
      for (const entry of written) {
        updated.push({ kind: 'block', name: entry.block, fields: [entry.field] });
      }
    }

    return { created, updated, newStoryId };
  });
}

/** The id of a card cast in this story, matched by name. Read inside the task. */
function castIdByName(storyId: string | null, name: string): string | undefined {
  if (!storyId) return undefined;
  const story = stories.get(storyId);
  if (!story) return undefined;
  return castOf(story).find((card) => card.name.toLowerCase() === name)?.id;
}

/** The id of a lore entry in this story, matched by title. Read inside the task. */
function loreIdByTitle(storyId: string | null, title: string): string | undefined {
  if (!storyId) return undefined;
  return lore.list(storyId).find((entry) => entry.title.toLowerCase() === title)?.id;
}

/** One library card by name; ambiguous names are refused before staging. */
function libraryCardByName(name: string): Character | null {
  const matches = characters.list().filter((card) => card.name.toLowerCase() === name);
  return matches.length === 1 ? (matches[0] as Character) : null;
}

/* ------------------------------------------------------------------ context */

/**
 * The history a page sent back, bounded. Untrusted by construction: it goes into
 * one side-channel request and can never reach the narrator's payload.
 */
export function normaliseHistory(
  raw: CreatorRequest['history'],
): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (turn): turn is { role: 'user' | 'assistant'; content: string } =>
        Boolean(turn) && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string',
    )
    .slice(-CREATOR_LIMITS.historyItems)
    .map((turn) => ({ role: turn.role, content: clip(text(turn.content), CREATOR_LIMITS.historyChars) }))
    .filter((turn) => turn.content.length > 0);
}

/** What the model is shown about the world, before it is asked anything. */
export function renderCreatorBrief(state: CreatorState, request: string): string {
  const story = state.story;
  const lines: string[] = [];

  lines.push(story ? `The writer has this story open: ${story.title}` : 'No story is open.');

  if (story) {
    const blocks = EDITABLE_BLOCKS.map((block) => {
      const body = String(story[EDITABLE_BLOCK_FIELD[block]] ?? '');
      return `- ${block}: ${body.trim() ? `${body.trim().length} characters` : 'EMPTY'}`;
    });
    lines.push(`\nDirective blocks:\n${blocks.join('\n')}`);

    const written = [...state.writtenBlocks];
    lines.push(
      written.length > 0
        ? `\nBlocks that already contain the writer's text: ${written.join(', ')}.`
        : '\nEvery directive block is empty — you may write any of them.',
    );

    if (story.scenario.trim()) lines.push(`\nCurrent scenario:\n${clip(story.scenario.trim(), CREATOR_LIMITS.briefBlockChars)}`);
    if (story.bible.trim()) lines.push(`\nCurrent story bible:\n${clip(story.bible.trim(), CREATOR_LIMITS.briefBlockChars)}`);
    if (story.genre.trim()) lines.push(`\nCurrent genre & tone:\n${clip(story.genre.trim(), CREATOR_LIMITS.briefBlockChars)}`);
    if (story.style.trim()) lines.push(`\nCurrent prose style:\n${clip(story.style.trim(), CREATOR_LIMITS.briefBlockChars)}`);

    const cast = [...state.castByName.values()];
    lines.push(
      cast.length > 0
        ? `\nCast (name — tagline — weight):\n${cast
            .map((card) => `- ${card.name}${card.tagline ? ` — ${card.tagline}` : ''}${card.tokens ? ` — ${card.tokens} tok` : ''}`)
            .join('\n')}`
        : '\nThe cast is empty.',
    );

    const entries = [...state.loreByTitle.values()];
    lines.push(
      entries.length > 0
        ? `\nLore entries (title [keys]):\n${entries
            .slice(0, CREATOR_LIMITS.briefLoreBodies)
            .map((entry) => `- ${entry.title}${entry.keys ? ` [${entry.keys}]` : ''}`)
            .join('\n')}`
        : '\nNo lore entries yet.',
    );
  }

  const library = [...state.libraryByName.values()].flat();
  lines.push(
    library.length > 0
      ? `\nCharacters that already exist in the library and can be cast without rewriting:\n${library
          .slice(0, CREATOR_LIMITS.briefLibraryCards)
          .map((card) => `- ${card.name}${card.tagline ? ` — ${card.tagline}` : ''}`)
          .join('\n')}`
      : '\nThe library has no other characters.',
  );

  lines.push(
    state.templateLabels.length > 0
      ? `\nPrompt templates already saved:\n${state.templateLabels.map((name) => `- ${name}`).join('\n')}`
      : '\nNo prompt templates saved yet.',
  );

  lines.push(`\nMacros available in directive text: ${MACROS.map((macro) => macro.name).join(', ')}.`);

  lines.push(
    state.allowOverwrite
      ? '\nRewriting is ENABLED for this request: you may replace a directive block that already has text.'
      : '\nRewriting is NOT enabled for this request: a directive block that already has text must be left alone. If one needs changing, say so in your reply.',
  );

  /* The targeting rule, stated where the model has to read it. Without this it
     writes a story and then has no idea which world the next call lands in. */
  lines.push(
    story
      ? '\nOne turn writes to one story. If you call create_story, this is the last block that describes the old one: everything else you write in this turn lands in the new story.'
      : '\nNo story is open. Call create_story first — everything else you write in this turn lands in the story you create. Until a story exists, the world tools have nowhere to write and will refuse.',
  );
  lines.push(`\nThe writer asks:\n\n${request}`);

  return lines.join('\n');
}

/* ---------------------------------------------------------------------- pass */

export type CreatorOptions = {
  model?: ModelId;
  effort?: ReasoningEffort;
  allowOverwrite?: boolean;
  signal?: AbortSignal;
};

/** The world the loop reads: one snapshot, taken once, before the model speaks. */
export function creatorState(story: Story | null, allowOverwrite: boolean): CreatorState {
  const castByName = new Map<string, Character>();
  const loreByTitle = new Map<string, LoreEntry>();
  const writtenBlocks = new Set<EditableBlock>();

  if (story) {
    for (const card of castOf(story)) castByName.set(card.name.toLowerCase(), card);
    for (const entry of lore.list(story.id)) loreByTitle.set(entry.title.toLowerCase(), entry);
    for (const block of EDITABLE_BLOCKS) {
      if (String(story[EDITABLE_BLOCK_FIELD[block]] ?? '').trim()) writtenBlocks.add(block);
    }
  }

  const libraryByName = new Map<string, Character[]>();
  for (const card of characters.list()) {
    const key = card.name.toLowerCase();
    const bucket = libraryByName.get(key);
    if (bucket) bucket.push(card);
    else libraryByName.set(key, [card]);
  }

  const templateNames = new Set<string>();
  const templateLabels: string[] = [];
  for (const template of [...BUILTIN_TEMPLATES, ...templates.list()]) {
    templateNames.add(template.name.toLowerCase());
    templateLabels.push(template.name);
  }

  return {
    story,
    allowOverwrite,
    castByName,
    loreByTitle,
    libraryByName,
    templateNames,
    templateLabels,
    writtenBlocks,
  };
}

/**
 * Every tool is offered on every request, including one with no story open.
 *
 * Filtering them down to `create_story` and `create_template` was the obvious
 * economy and it was wrong: a writer with no story open asking for "a story with
 * two officers" got a story and no way to cast them, and the model — having no
 * tool to call — said it had anyway. A tool that refuses with a readable reason is
 * a better brief than a tool that is absent, because the reason teaches the model
 * the one thing it has to do first.
 */
export async function runCreator(
  targetStoryId: string | null,
  request: string,
  history: CreatorRequest['history'] = [],
  options: CreatorOptions = {},
): Promise<CreatorResult> {
  const story = targetStoryId ? stories.get(targetStoryId) : null;
  const state = creatorState(story, options.allowOverwrite === true);
  const tools = CREATOR_TOOLS;
  const sink = emptySink();
  const model: ModelId = options.model ?? 'deepseek-flash';
  const effort: ReasoningEffort = options.effort ?? 'low';

  /* The page's own log, bounded, ahead of the brief so a follow-up can refer to
     what the last turn wrote. It is the page's text, not the studio's memory: the
     durable record of a turn is the rows in the database, and this is how a second
     turn reads them back in the writer's own words. */
  const pending: WireMessage[] = [
    { role: 'system', content: CREATOR_SYSTEM },
    ...normaliseHistory(history).map((turn): WireMessage => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: renderCreatorBrief(state, request) },
  ];

  let costUsd = 0;

  for (let round = 0; round < CREATOR_LIMITS.rounds; round += 1) {
    const result = await completeChat({
      messages: pending,
      model,
      effort,
      tools,
      maxTokens: 4_000,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    costUsd += recordSideCall(COST_KIND, targetStoryId, model, result);

    if (result.text.trim()) sink.reply = result.text.trim();
    if (result.toolCalls.length === 0) break;

    /* The API demands a full reasoning echo whenever tools are in play. */
    pending.push({
      role: 'assistant',
      content: result.text || null,
      ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const outcome = applyCreatorTool(call.function.name, safeArgs(call.function.arguments), sink, state);
      pending.push({ role: 'tool', tool_call_id: call.id, content: outcome });
    }
  }

  const applied =
    sink.drafts.length > 0
      ? applyCreatorDrafts(sink.drafts, targetStoryId)
      : { created: [] as CreatorCreated[], updated: [] as CreatorUpdate[], newStoryId: null };

  return {
    reply: sink.reply || summarise(applied.created, applied.updated, sink.refused),
    created: applied.created,
    updated: applied.updated,
    replacedBlocks: sink.replacedBlocks,
    refused: sink.refused,
    newStoryId: applied.newStoryId,
    costUsd,
    model,
  };
}

/** Last-resort reply when the model produced no text at all. Honest, not chatty. */
function summarise(
  created: readonly CreatorCreated[],
  updated: readonly CreatorUpdate[],
  refused: readonly { target: string }[],
): string {
  if (created.length === 0 && updated.length === 0) {
    return refused.length > 0 ? 'Nothing was written — see what was refused below.' : 'Nothing was written.';
  }
  const parts = [
    created.length > 0 ? `wrote ${created.map((row) => row.name).join(', ')}` : '',
    updated.length > 0 ? `revised ${updated.map((row) => row.name).join(', ')}` : '',
  ].filter(Boolean);
  return `${parts.join('; ')}.`;
}

/** Parse a tool call's arguments; a torn or absent payload becomes `{}`. */
export function safeArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
