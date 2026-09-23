/**
 * Domain types shared by server and web. Pure type declarations plus a few frozen
 * data tables and the tiny mappers that read them — no I/O, no state, nothing that
 * needs a store or a network to exercise.
 */

import type { MacroName } from './macros.ts';

export type Role = 'system' | 'user' | 'assistant';

export type Theme = 'ink' | 'ember' | 'verdant' | 'daylight';

/* ------------------------------------------------------------------ models */

export type ModelId = 'deepseek-flash' | 'deepseek-v4-pro';

export const MODELS: Record<ModelId, { label: string; blurb: string; vision: boolean }> = {
  'deepseek-flash': {
    label: 'DeepSeek V4.1 Flash',
    blurb: '1M context, vision, fastest. The workhorse for drafting and roleplay.',
    vision: true,
  },
  'deepseek-v4-pro': {
    label: 'DeepSeek V4 Pro',
    blurb: 'Slower, costlier, sharper at long-form structure. Reserve for hard passes.',
    vision: false,
  },
};

/**
 * `reasoning_effort` values accepted by the Chat Completions API.
 * `none` is the only value that *disables* thinking mode; everything else keeps
 * it on (minimal/low map to low, medium/high/xhigh map to high, max/ultra to max).
 * Thinking mode silently ignores temperature/presence/frequency penalties.
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max';

export const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'Off (thinking disabled)',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High (default)',
  max: 'Max',
};

/* ------------------------------------------------------------------ pricing */

/**
 * USD per 1M tokens. Off-peak rates are exactly half of peak.
 *
 * Peak windows are 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday. Everything
 * else — weekdays outside those windows, and all of Saturday/Sunday — is
 * off-peak.
 */
export type ModelPricing = {
  /** Input tokens that hit DeepSeek's disk cache. */
  cacheHit: number;
  /** Input tokens that missed the cache. */
  cacheMiss: number;
  /** Emitted tokens, including reasoning tokens. */
  output: number;
};

export const PRICING_OFF_PEAK: Record<ModelId, ModelPricing> = {
  'deepseek-flash': { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
  'deepseek-v4-pro': { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
};

export const PRICING_PEAK: Record<ModelId, ModelPricing> = {
  'deepseek-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
  'deepseek-v4-pro': { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
};

/** Cheapest model's off-peak cache-hit price — the unit of the "ledger" score. */
export const BASELINE_HIT_PRICE = PRICING_OFF_PEAK['deepseek-flash'].cacheHit;

/* ------------------------------------------------------------ prompt blocks */

/**
 * Roles in the request payload, in strictly ascending order.
 *
 * DeepSeek persists a cache prefix unit at every request boundary and a hit
 * requires a *full* match against one of those units, so anything that changes
 * often must sit as late in the payload as possible. Blocks are therefore sorted
 * by this table before the payload is assembled: a change to a block only
 * invalidates that block and everything after it.
 */
export const BLOCK_ORDER = [
  'contract',
  'genre',
  'style',
  'story',
  'scenario',
  'cast',
  'persona',
  'lore-anchor',
  'history',
  'lore-at-depth',
  'state',
  'director',
  'retrieval',
  'lore-before',
  'author-note',
  'lore-after',
  'exemplars',
  'impersonate',
  'instruct',
  /*
   * The pass brief: an agentic pass's own role and instructions, and the only
   * block that differs between a pass payload and the narration payload it rides.
   * Last, so that a pass and a narration turn share every byte in front of it.
   */
  'mode',
] as const;

export type BlockKind = (typeof BLOCK_ORDER)[number];

/**
 * The blocks a writer can author as free text, in payload order — a strict subset
 * of `BLOCK_ORDER`, since every other block is rendered from rows (cast, persona,
 * transcript) or written by an agent.
 *
 * This is the definition the story-settings editor builds its fields from, the
 * list a prompt template may fill, and the target a template is filed under. One
 * table, so a block cannot be editable in one place and missing in another.
 */
export const EDITABLE_BLOCKS = [
  'contract',
  'genre',
  'style',
  'story',
  'scenario',
  'exemplars',
  'instruct',
] as const;

export type EditableBlock = (typeof EDITABLE_BLOCKS)[number];

/** The `Story` column each editable block's text lives in. */
export type EditableBlockField =
  | 'contract'
  | 'genre'
  | 'style'
  | 'bible'
  | 'scenario'
  | 'exemplars'
  | 'instruct';

export const EDITABLE_BLOCK_FIELD: Record<EditableBlock, EditableBlockField> = {
  contract: 'contract',
  genre: 'genre',
  style: 'style',
  story: 'bible',
  scenario: 'scenario',
  exemplars: 'exemplars',
  instruct: 'instruct',
};

/** Narrowing helper: is this untrusted string one of the editable blocks? */
export function isEditableBlock(value: unknown): value is EditableBlock {
  return typeof value === 'string' && (EDITABLE_BLOCKS as readonly string[]).includes(value);
}

/**
 * The story fields a set of block texts would overwrite.
 *
 * Both apply paths go through this: the story editor layers it onto its unsaved
 * draft, and the template library saves it immediately through the ordinary story
 * PATCH — so "apply" has one meaning and one write path. `only` narrows to
 * specific blocks, which is how the editor applies just the block being edited;
 * empty text is skipped, because a template that fills three blocks must leave a
 * fourth alone.
 */
export function filledBlocks(template: PromptTemplate): EditableBlock[] {
  return (Object.keys(template.blocks) as EditableBlock[]).filter((block) => {
    const text = template.blocks[block];
    return typeof text === 'string' && text.trim().length > 0;
  });
}

export function templateStoryPatch(
  blocks: Partial<Record<EditableBlock, string>>,
  only?: readonly EditableBlock[],
): Partial<Record<EditableBlockField, string>> {
  const patch: Partial<Record<EditableBlockField, string>> = {};
  for (const block of only ?? EDITABLE_BLOCKS) {
    const text = blocks[block];
    if (text === undefined || !text.trim()) continue;
    patch[EDITABLE_BLOCK_FIELD[block]] = text;
  }
  return patch;
}

/**
 * Whether a story's block text still equals the template it was applied from.
 *
 * One definition, read by the composer's prompt picker and the rail's Prompt row,
 * so the two cannot disagree about whether a story is still speaking its prompt.
 * A template that has been edited since — or deleted, so the caller passes `null` —
 * is not a mismatch; it is a question with no answer, and `null` says so.
 */
export function templateMatch(
  template: PromptTemplate | null,
  story: Pick<Story, 'contract' | 'genre' | 'style' | 'bible' | 'scenario' | 'exemplars' | 'instruct'>,
): { filled: number; matching: number } | null {
  if (!template) return null;
  const blocks = filledBlocks(template);
  let matching = 0;
  for (const block of blocks) {
    const field = EDITABLE_BLOCK_FIELD[block];
    if ((template.blocks[block] ?? '') === (story[field] ?? '')) matching += 1;
  }
  return { filled: blocks.length, matching };
}

export const BLOCK_RANK: Record<BlockKind, number> = Object.fromEntries(
  BLOCK_ORDER.map((kind, index) => [kind, index]),
) as Record<BlockKind, number>;

export const BLOCK_LABELS: Record<BlockKind, string> = {
  contract: 'Voice & format contract',
  genre: 'Genre & tone',
  style: 'Prose style',
  story: 'Story bible',
  scenario: 'Scenario & world',
  cast: 'Cast cards',
  persona: 'Your persona',
  'lore-anchor': 'Lore (anchored)',
  history: 'Transcript',
  'lore-at-depth': 'Lore (depth)',
  state: 'Scene state',
  director: 'Director brief',
  retrieval: 'Recalled memories',
  'lore-before': 'Lore (before)',
  'author-note': 'Author note',
  'lore-after': 'Lore (after)',
  exemplars: 'Exemplars',
  impersonate: 'Impersonation brief',
  instruct: 'Post-history instruction',
  mode: 'Pass brief',
};

/**
 * Volatility of each block, 0 (frozen for the story's lifetime) to 3 (changes
 * most turns). Drives the composer's "cache risk" readout and the optimizer's
 * advice.
 */
export const BLOCK_VOLATILITY: Record<BlockKind, 0 | 1 | 2 | 3> = {
  contract: 0,
  genre: 0,
  style: 0,
  story: 1,
  scenario: 1,
  cast: 2,
  persona: 2,
  'lore-anchor': 2,
  history: 3,
  'lore-at-depth': 3,
  state: 3,
  director: 3,
  retrieval: 3,
  'lore-before': 3,
  'author-note': 3,
  'lore-after': 3,
  exemplars: 1,
  impersonate: 3,
  instruct: 3,
  mode: 3,
};

/* ------------------------------------------------------------------- lore */

/** Where a lore entry is injected relative to the transcript. */
export type LorePosition =
  /** Frozen, ranked with the cast cards. Cheap to keep stable. */
  | 'anchor'
  /** Inserted into the transcript at its configured depth from the end. */
  | 'depth'
  /** Before the newest user message. */
  | 'before'
  /** After the newest user message. */
  | 'after';

export type LoreEntry = {
  id: string;
  storyId: string;
  title: string;
  body: string;
  /** Comma-separated trigger keys. Empty means "never auto-fires". */
  keys: string;
  position: LorePosition;
  /** Depth-from-end when `position === 'depth'`; 0 means at the very end. */
  depth: number;
  /** Injection order within a position; lower first. */
  priority: number;
  /** 0..1. Scales the entry's retrieval score. */
  weight: number;
  /** Constant entries are always injected when budget allows. */
  constant: boolean;
  enabled: boolean;
  /** Token count of `body`, cached at write time. */
  tokens: number;
  createdAt: number;
  updatedAt: number;
};

/** A single injected lore entry, resolved for one turn. */
export type LoreHit = {
  entryId: string;
  title: string;
  body: string;
  position: LorePosition;
  depth: number;
  tokens: number;
  /** Why it fired: `constant`, `key`, `recalled:bm25`, `recalled:vector`. */
  reason: string;
  score: number;
};

/* --------------------------------------------------------------- entities */

export type Character = {
  id: string;
  /**
   * The story that authored the card — its home — or `null` once that story is
   * gone. A card is a library object: this says where it came from, not where it
   * is cast. Stories that adopted it are unaffected when this goes null.
   */
  homeStoryId: string | null;
  name: string;
  /** Short tagline shown on the card. */
  tagline: string;
  description: string;
  personality: string;
  /** Their speech habits; injected into the cast card verbatim. */
  speech: string;
  scenario: string;
  /** Example dialogue blocks, one per line group, rendered under `exemplars`. */
  exampleDialogue: string;
  /** Freeform JSON blob for imported cards (extensions, tags, alt greetings). */
  meta: Record<string, unknown>;
  avatar: string | null;
  tokens: number;
  order: number;
  createdAt: number;
  updatedAt: number;
};

export type Persona = {
  id: string;
  storyId: string;
  name: string;
  description: string;
  /** Data URL or remote URL, shown beside the writer's own turns. */
  avatar: string | null;
  tokens: number;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
};

/**
 * A named set of block texts the writer can apply in one action.
 *
 * Usually one entry — a snippet for the contract, say — but nothing stops a
 * "house voice" preset from filling the contract, the genre and the style
 * together. Applying copies the text into the story; the macros in it stay
 * unresolved, so the preset keeps resolving against whatever the story becomes.
 *
 * Templates are app-scoped rather than story-scoped so the same preset works
 * everywhere, and the code-shipped ones are not rows at all — they are constants
 * merged into the list, which is what lets a release fix one without a migration
 * and what makes "editable" mean "duplicate it first".
 */
export type PromptTemplate = {
  id: string;
  name: string;
  blurb: string;
  /** At least one non-empty entry, by the route's validation. */
  blocks: Partial<Record<EditableBlock, string>>;
  builtin: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type Story = {
  id: string;
  title: string;
  /** Genre/tone directive block. */
  genre: string;
  scenario: string;
  /** Long-form world bible. */
  bible: string;
  /** Prose style directive. */
  style: string;
  /** Example passages the model should imitate. */
  exemplars: string;
  /** Post-history instruction; the model sees this last. */
  instruct: string;
  personaId: string | null;
  /**
   * The prompt template this story speaks in, or `null` for "written by hand".
   *
   * **A link, not the text.** The blocks stay in the story's own columns, so a
   * story still resolves its macros and still survives the template's deletion
   * (`ON DELETE SET NULL`, never a cascade) — that part of "applying is copying"
   * has not changed and must not. What the column buys is the one fact copying
   * cannot express: *which* prompt was applied, so a conversation can say it,
   * re-apply it after an edit, and be asked to switch. `null` is the honest state
   * for a story whose blocks were written or edited by hand, and it is the state
   * every existing story starts in.
   */
  templateId: string | null;
  /**
   * Set on a 1:1 character chat: the card the chat is about. A chat's cast is
   * exactly that card and its persona pool is the pool of the story that owns it,
   * so the chat is otherwise an ordinary story — same transcript, same cache
   * prefix rules, same cost ledger. `null` on a story.
   */
  characterId: string | null;
  model: ModelId;
  effort: ReasoningEffort;
  temperature: number;
  topP: number;
  maxTokens: number;
  /** Target response length in words, communicated to the model and checked by Director. */
  targetWords: number;
  /** Frozen contract text; changing it invalidates the whole cache. */
  contract: string;
  /** Lore budget in tokens. */
  loreBudget: number;
  /** Transcript tokens to keep verbatim before summarising older turns. */
  historyBudget: number;
  /** Assistant prefill appended to the payload (Chat Prefix Completion). */
  prefill: string;
  theme: Theme;
  cover: string | null;
  /** Running summary of everything trimmed out of the transcript. */
  synopsis: string;
  createdAt: number;
  updatedAt: number;
};

export type SceneStateField = {
  key: string;
  value: string;
};

export type Scene = {
  id: string;
  storyId: string;
  title: string;
  /** Structured, tracked scene facts — time, place, who's present, stakes. */
  state: SceneStateField[];
  /** Non-model scaffolding the writer keeps for themselves. */
  notes: string;
  order: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

/** Director-tracked thread the narrator is expected to keep in play. */
export type Thread = {
  id: string;
  storyId: string;
  sceneId: string | null;
  label: string;
  status: 'open' | 'closed';
  /** Assistant message that opened it. */
  openedAt: string | null;
  resolvedAt: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Message = {
  id: string;
  storyId: string;
  sceneId: string;
  role: Role;
  /** Every candidate generation; `activeVariant` picks the visible one. */
  variants: string[];
  activeVariant: number;
  /** Per-variant reasoning traces, present only when thinking mode ran. */
  reasoning: string[];
  /** Set when this message was produced by an agentic pass. */
  origin: MessageOrigin;
  /** Name shown for the speaker, when it isn't "you" or the narrator. */
  speaker: string | null;
  /** Snapshot of the lore/retrieval that shaped this message, for debugging. */
  injections: LoreHit[];
  /** Usage for the active variant. */
  usage: MessageUsage | null;
  pinned: boolean;
  /** Excluded from the payload without being deleted. */
  disabled: boolean;
  /**
   * Position within the story's transcript. Assigned by the store on insert and
   * preserved across exports, imports and story duplication so ordering — and
   * therefore the cached prefix — survives a round trip.
   */
  seq: number;
  createdAt: number;
  updatedAt: number;
};

export type MessageOrigin =
  | 'user'
  | 'narrator'
  | 'continue'
  | 'impersonate'
  | 'greeting'
  | 'rewrite'
  | 'conductor'
  | 'expansion';

export type MessageUsage = {
  model: ModelId;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  ttftMs: number | null;
  totalMs: number;
  costUsd: number;
  savedUsd: number;
  /** Serialised payload fingerprint this request was built from. */
  fingerprint: string;
  effort: ReasoningEffort;
  peak: boolean;
};

/* ----------------------------------------------------------------- agents */

/**
 * Director note kinds. The list is the source of truth: the union derives from it
 * and both the server's validator and the UI's picker read it, so a new kind
 * cannot exist in one place and not the others.
 */
export const NOTE_KINDS = ['observe', 'nudge', 'state', 'thread', 'critique'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export type DirectorNote = {
  id: string;
  storyId: string;
  messageId: string | null;
  kind: NoteKind;
  body: string;
  /** Value the Director suggested for a scene state field, when kind==='state'. */
  payload: Record<string, unknown> | null;
  accepted: boolean;
  createdAt: number;
};

/* ------------------------------------------------- creation assistant */

/**
 * The assistant's conversation is app-scoped, not story-scoped: it is a studio
 * object, and it is deliberately *not* a transcript. Nothing in `CreatorMessage`
 * ever reaches the composer.
 */
export type CreatorRole = 'user' | 'assistant';

/** A row the assistant wrote, named so the receipt can say what landed where. */
export type CreatorCreated = {
  /**
   * `cast` is a membership, not a card: adopting an existing character into a
   * story writes one `story_cast` row and re-prices everything the cast block
   * carries. It is a creation, and it is reported like one.
   */
  kind: 'story' | 'character' | 'lore' | 'template' | 'cast';
  id: string;
  name: string;
  /** Which world it landed in: null for a library card with no home, or a template. */
  storyId: string | null;
  /** Cards, casts and lore entries only — what this added to the frozen prefix. */
  tokens?: number;
};

/** A row the assistant changed, and which fields moved. */
export type CreatorUpdate = {
  kind: 'character' | 'lore' | 'block';
  name: string;
  fields: string[];
};

/**
 * What one assistant turn did — the receipt.
 *
 * The receipt is the point of the return type *and* the point of storing it: the
 * writer has to be able to see everything that changed, everything that was
 * refused, and which frozen blocks moved. A write that re-prices the cache prefix
 * must never be invisible, and a receipt that only existed for one render would be.
 */
export type CreatorResult = {
  /** A short summary of the turn. Not prose fiction, and never a tool transcript. */
  reply: string;
  created: CreatorCreated[];
  updated: CreatorUpdate[];
  /** Non-empty story blocks this turn replaced, so the prefix movement is named. */
  replacedBlocks: EditableBlock[];
  /** Targets left alone, each with the reason, in the writer's language. */
  refused: { target: string; reason: string }[];
  /** Set when the turn minted a story, so the page can offer to open it. */
  newStoryId: string | null;
  costUsd: number;
  model: ModelId;
};

/**
 * One message in the assistant's own conversation.
 *
 * A user row records the two things that governed the turn it opened — where it
 * could write, and whether it could replace existing text — because a receipt read
 * back a week later has to say what it was allowed to do, not just what it did.
 */
export type CreatorMessage = {
  id: string;
  role: CreatorRole;
  body: string;
  /** The turn's receipt on an assistant row; null on the writer's own row. */
  receipt: CreatorResult | null;
  allowOverwrite: boolean;
  targetStoryId: string | null;
  at: number;
};

/** Memory kinds, same contract as `NOTE_KINDS`. */
export const MEMORY_KINDS = ['fact', 'relationship', 'promise', 'trait', 'place'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type Memory = {
  id: string;
  storyId: string;
  /** The fact, written as a standalone sentence. */
  text: string;
  /** Character/place it concerns, for filtering. */
  subject: string;
  /** Transcript message this was distilled from. */
  sourceMessageId: string | null;
  /** Story position, used to bias toward recent memory. */
  seq: number;
  /** 0..1 confidence reported by the archivist. */
  salience: number;
  kind: MemoryKind;
  createdAt: number;
};

/**
 * Which pass spent the money. The ledger sums by kind, so a pass that reports
 * under another pass's name makes the cost panel silently wrong — each agentic
 * pass therefore has its own kind.
 */
export type CostEventKind =
  | 'narration'
  | 'director'
  | 'archivist'
  | 'summarise'
  | 'conductor'
  | 'judge'
  | 'creator';

export type CostEvent = {
  id: number;
  storyId: string | null;
  kind: CostEventKind;
  model: ModelId;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  savedUsd: number;
  peak: boolean;
  createdAt: number;
};

/* -------------------------------------------------------------- wire types */

export type Usage = {
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type CostEstimate = {
  exact: boolean;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  costUsd: number;
  /** What the same request would cost with a cold cache. */
  coldCostUsd: number;
  savedUsd: number;
  peak: boolean;
  model: ModelId;
};

export type PromptBlockPreview = {
  kind: BlockKind;
  label: string;
  tokens: number;
  volatility: 0 | 1 | 2 | 3;
  /** Content hash; changes here invalidate this block and everything after it. */
  hash: string;
  /** True when this block changed since the previous turn's payload. */
  changed: boolean;
  /** Tokens that survive from the previous turn up to and including this block. */
  stablePrefixTokens: number;
  /**
   * Macros this block expanded, in first-appearance order. Empty on the
   * transcript, which is a record rather than a template — and worth showing,
   * because a macro in a frozen block re-prices everything behind it whenever its
   * value changes.
   */
  macros: MacroName[];
  preview: string;
};

/**
 * The composer's self-report: what it built, what it costs, and how much of the
 * prefix DeepSeek should be able to serve from cache.
 */
export type PayloadPlan = {
  storyId: string;
  fingerprint: string;
  blocks: PromptBlockPreview[];
  messages: number;
  totalTokens: number;
  /** Tokens guaranteed to match the previous turn's payload, from position 0. */
  stablePrefixTokens: number;
  /** The turn's own hash, for comparing against what the cache actually did. */
  estimate: CostEstimate;
  /** Predicted hit rate against the previous turn, 0..1. */
  predictedHitRate: number;
  /** Measured hit rate for the previous turn, or null when there is none. */
  previousHitRate: number | null;
  loreHits: LoreHit[];
  retrieval: { memoryId: string; text: string; score: number }[];
  includeTools: boolean;
  effort: ReasoningEffort;
  warnings: string[];
  /** Concrete, ranked suggestions to raise the hit rate. */
  advice: string[];
};

/* ----------------------------------------------------------- stream events */

export type StreamEvent =
  | { type: 'plan'; plan: PayloadPlan }
  | { type: 'start'; messageId: string; variantIndex: number }
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; args: string; ok: boolean; summary: string }
  | { type: 'usage'; usage: MessageUsage }
  | { type: 'note'; note: Pick<DirectorNote, 'kind' | 'body'> }
  | { type: 'tip'; advice: string[] }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string }
  | { type: 'aborted' };

export type ChatRequest = {
  storyId: string;
  sceneId: string;
  mode: 'send' | 'regenerate' | 'continue' | 'impersonate' | 'variant';
  /** Text for `send`. */
  text?: string;
  /** Target message for `regenerate` / `variant`. */
  messageId?: string;
  /** Grounding brief for `impersonate`. */
  brief?: string;
  /** Overrides applied for this turn only. */
  overrides?: Partial<
    Pick<
      Story,
      'model' | 'effort' | 'temperature' | 'topP' | 'maxTokens' | 'prefill' | 'targetWords'
    >
  > & {
    /** Toggle optional agentic passes for this turn. */
    director?: boolean;
    archivist?: boolean;
    recall?: boolean;
    conductor?: boolean;
    conductorVariants?: number;
    /** Disable thinking and echo reasoning back, when tools are present. */
    includeTools?: boolean;
    /** Mid-conversation steering from the writer. Lands in the volatile tail. */
    authorNote?: string;
    /** Override the number of recalled memories injected this turn. */
    recallLimit?: number;
  };
};

export const DEFAULT_CONTRACT = `You are the narrator of an ongoing collaborative story.

Rules of the page:
- Write in prose. Second person for {{user}}, third person for everyone else, unless the story below says otherwise.
- Obey {{user}}. Never write {{user}}'s dialogue, thoughts, or decisions, and never narrate their actions as settled fact.
- Stay in scene. Do not summarise, editorialise, or address the reader.
- Show through action, sensation, and speech. Withhold what a character would withhold.
- End on forward motion — an unanswered question, an offer, a turn of the screw.

Formatting:
- Plain prose paragraphs separated by blank lines. *Single asterisks* for emphasis only.
- Wrap spoken dialogue in double quotes, with the speaker identifiable from context.`;

export const DEFAULT_GENRE = `Genre: dark fantasy with a slow-burn political spine.
Tone: wry, tactile, intimate; dread that creeps rather than shouts.`;

export const DEFAULT_STYLE = `Voice: close third, concrete nouns, short declaratives over long chains, no purple similes.
Pacing: one beat of action, one beat of interiority, then land the paragraph on an image.
Forbidden: "a shiver ran down", "let out a breath he didn't know he was holding", "little did they know", em-dash pileups, stacked adverbs.`;
