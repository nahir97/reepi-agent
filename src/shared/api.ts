/**
 * Frozen HTTP contract. Both the server routes and the web client compile
 * against exactly these types, so a drift between the two is a type error rather
 * than a runtime surprise.
 */

import type {
  Calibration,
} from './tokens.ts';
import type { MacroGroup, MacroName } from './macros.ts';
import type {
  Character,
  CostEvent,
  CostEventKind,
  CreatorMessage,
  DirectorNote,
  EditableBlock,
  LoreEntry,
  Memory,
  Message,
  ModelId,
  PayloadPlan,
  Persona,
  ReasoningEffort,
  Scene,
  Story,
  Theme,
  Thread,
} from './types.ts';

/** Everything a story owns, in one payload — the UI's single load call. */
export type StoryBundle = {
  story: Story;
  scenes: Scene[];
  characters: Character[];
  personas: Persona[];
  lore: LoreEntry[];
  messages: Message[];
  memories: Memory[];
  threads: Thread[];
  notes: DirectorNote[];
};

/**
 * The whole character library, in one read: every card, plus every cast
 * membership. The Cast page's `Library` scope needs both — the cards to show,
 * the memberships to say which stories each one is in — and the cross-story
 * delete confirm needs the memberships before the card is gone.
 *
 * Cards are *not* children of a story any more, so this is app-scoped rather
 * than story-scoped: `/api/characters`, not `/api/stories/:id/characters`.
 */
export type CastIndex = {
  characters: Character[];
  casts: { storyId: string; characterId: string }[];
};

/** Adding an existing card to a story's cast. */
export type CastAttachBody = { characterId: string };

/**
 * Starting a chat. `fromStoryId` lends a world to a card whose home story is
 * gone; `greeting` is an index into the card's usable greetings
 * (`greetingsOf(character)`), choosing which opening line seeds the transcript —
 * omitted means the card's opening line.
 */
export type StartChatBody = { fromStoryId?: string; greeting?: number };

export type Insights = {
  totals: {
    costUsd: number;
    savedUsd: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    requests: number;
    /** Realised cache hit rate across every recorded request. */
    hitRate: number;
    /** Cost of a cache-hit token vs a cache-miss token, as a multiple. */
    cacheRatio: number;
    wordsWritten: number;
  };
  byKind: { kind: CostEventKind; costUsd: number; requests: number; hitRate: number }[];
  byModel: { model: ModelId; costUsd: number; requests: number; hitRate: number }[];
  /** Chronological, for the sparkline. */
  timeline: { at: number; costUsd: number; hitRate: number; kind: CostEventKind }[];
  last: CostEvent | null;
  peak: boolean;
  msUntilOffPeak: number;
  projection: {
    perTurnUsd: number;
    per100TurnsUsd: number;
    per1kWordsUsd: number;
    /** What 100 turns would cost with no cache discipline at all. */
    naivePer100TurnsUsd: number;
  };
  warmup: { fingerprint: string; warmedAt: number; tokens: number; costUsd: number } | null;
};

export type AccountInfo = {
  keyPresent: boolean;
  balanceUsd: number | null;
  available: boolean;
  models: string[];
  calibration: Calibration;
};

export type DiagnoseCheck = {
  id: string;
  label: string;
  level: 'pass' | 'warn' | 'fail';
  detail: string;
  /** Actionable next step, when there is one. */
  fix?: string;
};

export type DiagnoseReport = {
  checks: DiagnoseCheck[];
  cacheSmoke: {
    ran: boolean;
    hitTokens: number;
    missTokens: number;
    hitRate: number;
    firstMs: number;
    secondMs: number;
    verdict: string;
  } | null;
};

export type WarmupResult = {
  fingerprint: string;
  tokens: number;
  /** True when the probe confirmed the prefix is already being served from cache. */
  confirmedHit: boolean;
  costUsd: number;
  firstPass: { cacheHitTokens: number; cacheMissTokens: number; ttftMs: number | null };
  secondPass: { cacheHitTokens: number; cacheMissTokens: number; ttftMs: number | null };
};

export type ConductorResult = {
  kind: 'conductor';
  candidates: { index: number; text: string; rationale: string }[];
  chosen: number;
  judgeNote: string;
  costUsd: number;
};

export type DirectorResult = {
  notes: Pick<DirectorNote, 'kind' | 'body'>[];
  stateUpdates: { key: string; value: string }[];
  threadsOpened: string[];
  threadsClosed: string[];
  costUsd: number;
};

/* -------------------------------------------------------- creation assistant */

/**
 * One request to the creation assistant.
 *
 * `targetStoryId` is the story the turn may write into, and it is explicit and
 * optional: null means "no world", which is a legitimate way to work — characters
 * become library cards with no home story, templates are app-scoped, and a whole
 * story can be created by the turn itself. It is a parameter of the *request*
 * rather than an ambient "whatever story is open" precisely so a turn can never
 * write into a world the writer was not looking at.
 *
 * `allowOverwrite` is the only way the assistant may replace a block that already
 * has text. It is a per-request flag rather than a prompt instruction because the
 * rule has to hold when the model ignores the prompt — and because the writer's
 * authored prose is the one thing here a bad generation could destroy.
 *
 * The conversation itself is not sent with the request: the server reads it back
 * from its own table, so the only untrusted input is the ask.
 */
export type CreatorRequest = {
  request: string;
  targetStoryId?: string | null;
  allowOverwrite?: boolean;
  model?: ModelId;
  effort?: CreatorEffort;
};

/** Thinking is deliberately limited: this pass writes structure, not prose. */
export type CreatorEffort = 'none' | 'minimal' | 'low';

/** One turn of the conversation: the writer's ask, and the assistant's answer. */
export type CreatorTurn = {
  request: CreatorMessage;
  reply: CreatorMessage;
};

/**
 * The answer to a turn.
 *
 * A stopped turn is a success — the writer asked for it, nothing was written, and
 * nothing was recorded — so it is a 200 with `aborted: true` rather than an error
 * the page would have to explain.
 */
export type CreatorResponse = {
  aborted: boolean;
  turn: CreatorTurn | null;
};

export type ArchivistResult = {
  memories: Pick<Memory, 'text' | 'subject' | 'kind' | 'salience'>[];
  costUsd: number;
};

export type SummaryResult = {
  synopsis: string;
  costUsd: number;
  /** Set when the pass deliberately did nothing, explaining why. */
  note?: string;
  /** How many transcript messages were folded into the synopsis. */
  compressed?: number;
};

/* --------------------------------------------------------- request bodies */

export type StoryCreateBody = Partial<Story> & { title: string; template?: StoryTemplateId };

export type StoryTemplateId = 'hollow-court' | 'noir' | 'cozy' | 'space-opera' | 'blank';

/* -------------------------------------------------------- prompt templates */

/**
 * The body of a template write. The entity itself is a stored row and lives in
 * `types.ts` with the other entities; this is only what a client may send.
 */
export type PromptTemplateBody = {
  name?: string;
  blurb?: string;
  blocks?: Partial<Record<EditableBlock, string>>;
  sortOrder?: number;
};

/**
 * One row of the macro reference the editor shows.
 *
 * `value` is resolved against a story when the caller names one and is `null`
 * otherwise — the editor still lists names, labels and hints, so a template can
 * be written with no story open. The values come from the composer's own
 * resolver, so the reference cannot advertise something the payload would not do.
 */
export type MacroInfo = {
  name: MacroName;
  label: string;
  group: MacroGroup;
  hint: string;
  value: string | null;
};

export type ImportBody = {
  /** `json` is our own bundle, `chara` is a SillyTavern v2 PNG, `text` is plain prose. */
  format: 'json' | 'chara' | 'text';
  /** Base64 (optionally a data: URL) for `chara`, raw text otherwise. */
  data: string;
  title?: string;
};

export type ExportFormat = 'json' | 'chara' | 'markdown';

export type BranchBody = {
  messageId: string;
  title?: string;
};

export type VariantBody = { index?: number; text?: string };



/** Serialised into the SSE stream as `StreamEvent` frames. */
export type { PayloadPlan };

export const TEMPLATES: Record<
  StoryTemplateId,
  { label: string; blurb: string; seed: Partial<Story> }
> = {
  'hollow-court': {
    label: 'The Hollow Court',
    blurb: 'Dark fantasy intrigue. Oath, ash, and a throne nobody admits is empty.',
    seed: {
      title: 'The Hollow Court',
      genre:
        'Genre: dark fantasy with a slow-burn political spine.\nTone: wry, tactile, intimate; dread that creeps rather than shouts.',
      scenario:
        'The court has been in mourning for a king who is not dead. Every faction knows it. Nobody says it aloud.',
      bible:
        'The Hollow Court sits above the tide-bound archive, a library that floods at every full moon.\nOaths are physical: a sworn word leaves a silver scar on the palm, and a broken one burns the scar black.\nThe Ash Crown has no wearer. It waits on a stand in the throne room, and the throne room is never empty.',
      theme: 'ink',
    },
  },
  noir: {
    label: 'Rain Ledger',
    blurb: 'Hardboiled noir. A city that keeps receipts on everyone.',
    seed: {
      title: 'Rain Ledger',
      genre:
        'Genre: hardboiled noir.\nTone: bone-dry, first-person adjacent, every compliment a threat.',
      scenario: 'A missing ledger, three people who want it, and a week of rain.',
      bible:
        'The city runs on favours recorded in a single leather ledger. Whoever holds it holds the town.\nIt went missing from a locked office on a Tuesday.',
      theme: 'verdant',
    },
  },
  cozy: {
    label: 'The Long Kitchen',
    blurb: 'Gentle slice-of-life. Warmth, small stakes, real people.',
    seed: {
      title: 'The Long Kitchen',
      genre: 'Genre: cosy slice-of-life.\nTone: warm, unhurried, attentive to small sensory detail.',
      scenario: 'A shared kitchen in a rambling house, and the people who keep finding their way back to it.',
      bible:
        'The house has one long kitchen with a table that seats eleven and has never seated eleven.\nSomeone always leaves bread proofing overnight.',
      theme: 'ember',
    },
  },
  'space-opera': {
    label: 'Slow Light',
    blurb: 'Space opera with relativistic consequences.',
    seed: {
      title: 'Slow Light',
      genre: 'Genre: space opera with hard edges.\nTone: awed, dry-humoured, alive to the cost of distance.',
      scenario: 'A courier ship carries the only copy of a treaty that will be obsolete on arrival.',
      bible:
        'There is no ansible. Every message is a physical thing that must be carried.\nShips run on borrowed time and mass the way sailors ran on rum and salt.',
      theme: 'ink',
    },
  },
  blank: {
    label: 'Blank page',
    blurb: 'Start from nothing but the contract.',
    seed: { title: 'Untitled Story', theme: 'ink' },
  },
};
