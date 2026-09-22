/**
 * The store's vocabulary.
 *
 * Every type the store exposes to the UI lives here, including the `Store`
 * interface itself. Separating it means a component can import the shape of the
 * store without pulling in the store: `import type { Store } from '../store/types.ts'`
 * has no runtime cost and cannot create an import cycle.
 */

import type {
  AccountInfo,
  CastIndex,
  CreatorCreated,
  CreatorUpdate,
  DiagnoseReport,
  ExportFormat,
  Insights,
  MacroInfo,
  PromptTemplateBody,
  StoryBundle,
  StoryTemplateId,
  WarmupResult,
} from '../../shared/api.ts';
import type {
  ChatRequest,
  DirectorNote,
  EditableBlock,
  Message,
  PayloadPlan,
  PromptTemplate,
  Scene,
  Story,
  Theme,
} from '../../shared/types.ts';

export type RightTab = 'blocks' | 'cast' | 'persona' | 'lore' | 'memory' | 'scene' | 'director';

/**
 * What the payload rail is showing: a section, or `null` for the section menu.
 *
 * The rail is a drill-down rather than a tab strip — seven tabs in a 21rem column
 * is a strip nobody reads, and none of them could say anything about its own
 * contents. A menu row can: it carries the section's live summary, which is what
 * makes the list worth a level of navigation.
 */
export type RailView = RightTab | null;

/**
 * What the centre column is showing.
 *
 * `story` is the transcript — the product. `cast` and `creator` replace the centre
 * column while the writer is building rather than writing: a roster needs the
 * window to be scanned, and the creation assistant needs it for a request box and
 * the log of what it made. `null` is not a page — the story is what every other
 * surface returns to.
 *
 * A page rather than a dialog because these are places you *stay*: the cast page's
 * card editor closes back to a page that never went away, and a 54rem frame
 * floating over the prose is the wrong shape for a list or a conversation.
 */
export type Page = 'story' | 'cast' | 'creator';

/**
 * One exchange with the creation assistant, as the page remembers it.
 *
 * Session-only on purpose (see the feature Agent Note): the durable record of a
 * turn is the rows it wrote, and those are read back from the server like any
 * other content. This is the *display* of what just happened — the receipt — which
 * is why it carries the refusals and the replaced blocks too.
 */
export type CreatorTurn = {
  id: string;
  request: string;
  reply: string;
  created: CreatorCreated[];
  updated: CreatorUpdate[];
  /** Frozen blocks this turn replaced. Each one re-priced the prefix behind it. */
  replacedBlocks: EditableBlock[];
  refused: { target: string; reason: string }[];
  /** Set when this turn minted a story, so the receipt can offer to open it. */
  newStoryId: string | null;
  costUsd: number;
  /** Whether rewriting was enabled for this turn — the log has to say why it could. */
  allowOverwrite: boolean;
  at: number;
};

export type CreatorState = {
  /** Oldest first, so the page reads like a conversation. */
  log: CreatorTurn[];
  busy: boolean;
  /** Why the last turn failed, held for an inline line rather than only a toast. */
  error: string | null;
};

/**
 * `nav` is the phone's menu-and-library sheet; `right` is the story inspector.
 * There is no `left`: the library is a drawer-shaped list inside `nav` rather
 * than a second sheet, so the two could not drift apart.
 */
export type Drawer = 'right' | 'nav' | null;

export type Toast = {
  id: string;
  kind: 'error' | 'ok' | 'info';
  title: string;
  detail?: string;
};

export type LiveToolEvent = { name: string; args: string; ok: boolean; summary: string };

export type StreamingState = {
  active: boolean;
  mode: ChatRequest['mode'] | null;
  messageId: string | null;
  text: string;
  reasoning: string;
  tools: LiveToolEvent[];
  tips: string[];
  notes: Pick<DirectorNote, 'kind' | 'body'>[];
  usage: Message['usage'];
  error: string | null;
  startedAt: number;
};

/** The two kinds of card a story carries: characters, and the writer's personas. */
export type CardKind = 'character' | 'persona';

export type Dialog =
  | { kind: 'story-settings' }
  | { kind: 'import-export' }
  | { kind: 'new-story' }
  | { kind: 'prompt-templates' }
  | { kind: 'insights' }
  | { kind: 'card'; card: CardKind; id: string }
  | { kind: 'confirm'; title: string; body: string; confirmLabel: string; danger: boolean; run: () => void }
  | null;

export type TurnOverrides = NonNullable<ChatRequest['overrides']>;

export type StoryStat = { costUsd: number; savedUsd: number; words: number; hitRate: number; requests: number };

export type Store = {
  /* ------------------------------------------------------------- library */
  stories: Story[];
  storyStats: Record<string, StoryStat>;
  activeStoryId: string | null;
  /** The writer's chosen scene; falls back to the first unarchived one. */
  activeSceneId: string | null;
  bundle: StoryBundle | null;
  /**
   * The character library's read model: every card, plus every cast membership.
   *
   * Loaded by the Cast page rather than by `openStory`, because it is app-scoped
   * and only that page needs it — `null` means "never fetched", which is what
   * `refreshCastLibrary` keys off so editing a card from the rail does not pull a
   * list nobody is looking at.
   */
  castLibrary: CastIndex | null;
  /** Why the library read failed, if it did. Shown inline on the Cast page. */
  castLibraryError: string | null;
  loadingBundle: boolean;
  booted: boolean;
  offline: string | null;

  /* ---------------------------------------------------------- cache meter */
  plan: PayloadPlan | null;
  planBusy: boolean;

  /* ------------------------------------------------------------ streaming */
  streaming: StreamingState;

  /* ----------------------------------------------------------- instruments */
  insights: Insights | null;
  account: AccountInfo | null;
  diagnose: DiagnoseReport | null;
  warmup: WarmupResult | null;
  busy: string | null;

  /* ------------------------------------------------------ prompt templates */
  /** Starters first, then the writer's own. App-scoped, never story data. */
  promptTemplates: PromptTemplate[];
  /**
   * The macro reference, resolved for the open story when there is one. Held in
   * the store rather than fetched by each dialog: the template editor and the
   * story editor show the same values, and two fetches would be two answers.
   */
  macros: MacroInfo[];

  /* -------------------------------------------------- creation assistant */
  /** The session's exchanges, and whether one is in flight. Never persisted. */
  creator: CreatorState;

  /* -------------------------------------------------------------- chrome */
  theme: Theme;
  /** Whether the payload rail is open on a wide screen. Persisted. */
  railOpen: boolean;
  /** Which page the centre column shows. `story` is the transcript. */
  page: Page;
  ui: { rightTab: RailView; drawer: Drawer; dialog: Dialog; palette: boolean; toasts: Toast[] };

  /* ------------------------------------------------------------ actions */
  boot: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setStoryTheme: (storyId: string, theme: Theme) => Promise<void>;
  loadStories: () => Promise<void>;
  loadStoryStats: () => Promise<void>;
  openStory: (storyId: string) => Promise<void>;
  refreshBundle: (options?: { quiet?: boolean }) => Promise<void>;
  createStory: (title: string, template: StoryTemplateId) => Promise<string | null>;
  duplicateStory: (storyId: string) => Promise<void>;
  archiveStory: (storyId: string) => Promise<void>;
  updateStory: (patch: Partial<Story>) => Promise<void>;

  loadTemplates: () => Promise<void>;
  /** Create (`id === null`) or update a template, and adopt the stored row. */
  saveTemplate: (id: string | null, body: PromptTemplateBody) => Promise<PromptTemplate | null>;
  removeTemplate: (id: string) => Promise<void>;
  loadMacros: () => Promise<void>;
  /**
   * Write a template's blocks into the open story, immediately.
   *
   * The library applies through the same story PATCH the editor saves with, so
   * there is one write path. `only` limits it to one block, which is what the
   * per-block menu in the story editor means by "apply".
   */
  applyTemplate: (template: PromptTemplate, only?: readonly EditableBlock[]) => Promise<void>;

  createScene: (patch?: Partial<Scene>) => Promise<void>;
  switchScene: (sceneId: string) => Promise<void>;
  updateScene: (sceneId: string, patch: Partial<Scene>) => Promise<void>;
  archiveScene: (sceneId: string) => Promise<void>;

  /**
   * Ask the creation assistant for world material.
   *
   * `allowOverwrite` is the writer's per-request consent to replace a directive
   * block that already has text; without it the server refuses and the receipt
   * says so. The action refreshes everything a turn could have moved — the bundle,
   * the cast library, the templates, the story list and the payload plan — so what
   * the page shows after a turn is the database's answer, not the model's claim.
   */
  runCreator: (input: { text: string; allowOverwrite: boolean }) => Promise<void>;
  /** Drop this session's log. The rows it wrote are untouched. */
  clearCreatorLog: () => void;

  /**
   * Add a card, then open its editor. Living here rather than in the host is what
   * lets the rail's create buttons and the cast page's be one code path instead of
   * two that drift.
   */
  createCard: (card: CardKind) => Promise<void>;

  /**
   * Open this character's 1:1 chat, creating it the first time. A card has at
   * most one chat, so this is "open or start" rather than "create".
   *
   * `fromStoryId` names the world to seed from when the card's home story is
   * gone — it must be a story that casts the card. Only that case needs it.
   */
  startChatWith: (characterId: string, fromStoryId?: string) => Promise<void>;

  /** Read the whole character library. */
  loadCastLibrary: () => Promise<void>;
  /** Re-read it, but only if something has already loaded it. */
  refreshCastLibrary: () => Promise<void>;
  /** Adopt an existing card into the open story's cast. */
  addToCast: (characterId: string) => Promise<void>;
  /** Drop a card from the open story's cast, leaving the card alone. */
  removeFromCast: (characterId: string) => Promise<void>;

  setRightTab: (tab: RailView) => void;
  setRailOpen: (open: boolean) => void;
  setPage: (page: Page) => void;
  setDrawer: (drawer: Drawer) => void;
  openDialog: (dialog: Dialog) => void;
  setPalette: (open: boolean) => void;
  toast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  fail: (error: unknown, title?: string) => void;

  refreshPlan: (request: ChatRequest) => Promise<void>;
  schedulePlan: (request: ChatRequest, delayMs?: number) => void;
  runTurn: (call: ChatRequest) => Promise<void>;
  abort: () => void;

  continueFrom: (messageId?: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  impersonate: (brief: string) => Promise<void>;

  patchMessage: (messageId: string, patch: Partial<Message>) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  selectVariant: (messageId: string, index: number) => Promise<void>;
  branchFrom: (messageId: string) => Promise<void>;

  refreshInsights: (signal?: AbortSignal) => Promise<void>;
  refreshAccount: () => Promise<void>;
  runDiagnose: () => Promise<void>;
  runWarm: (overrides?: TurnOverrides) => Promise<void>;
  runAgentic: (pass: 'director' | 'archivist' | 'summarise' | 'conductor') => Promise<void>;

  acceptNote: (noteId: string) => Promise<void>;
  dismissNote: (noteId: string) => Promise<void>;

  exportStory: (format: ExportFormat) => Promise<void>;
  importStory: (format: 'json' | 'chara' | 'text', data: string, title?: string) => Promise<void>;

  activeStory: () => Story | null;
  activeScene: () => Scene | null;
};
