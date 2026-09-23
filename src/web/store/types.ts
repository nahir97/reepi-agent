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
  CreatorMessage,
  DirectorNote,
  EditableBlock,
  Message,
  PayloadPlan,
  PromptTemplate,
  Scene,
  Story,
  Theme,
} from '../../shared/types.ts';

export type RightTab =
  | 'blocks'
  | 'templates'
  | 'cast'
  | 'persona'
  | 'lore'
  | 'memory'
  | 'scene'
  | 'director';

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
 * The template most recently applied to the open story, **this session only**.
 *
 * There is deliberately no `stories.template_id`: applying a prompt is a copy,
 * and a stored reference would be a second source of truth for text the story
 * already holds. But a writer who has just applied "House voice" should not have
 * to remember that they did, so the rail's Prompt row reads this to say which
 * prompt it was and how many of its blocks still match. It is cleared by
 * `openStory`, and it survives no reload — the UI says "applied this session"
 * rather than implying the story owns a template.
 */
export type AppliedTemplate = {
  templateId: string;
  name: string;
  at: number;
};

/**
 * What the centre column is showing.
 *
 * `story` is the transcript — the product. Every other value replaces the centre
 * column while the writer is building, choosing or configuring rather than
 * writing: a roster needs the window to be scanned, the assistant needs it for a
 * request box and the log of what it made, and the launcher needs it because
 * "which conversation am I in" is a question that deserves a screen of its own.
 *
 * `discover` is the way *out* of a story, and the only page that is also a
 * destination in its own right: it is where a session with nothing open lands,
 * and where the header's home control returns to.
 *
 * `cast` and `characters` are deliberately two pages. `cast` is the payload
 * roster — what this story sends, totalled in tokens; `characters` is the
 * app-wide library, personas included, where "who am I when I talk to them" has
 * a home above any single story.
 *
 * A page rather than a dialog because these are places you *stay*: a page's card
 * editor closes back to a page that never went away, and a 54rem frame floating
 * over the prose is the wrong shape for a list or a conversation.
 */
export type Page = 'story' | 'discover' | 'characters' | 'settings' | 'cast' | 'creator';

/**
 * The creation assistant's conversation.
 *
 * App-scoped and read back from the server, not held as a page's private log: the
 * assistant is a studio surface, so a reload has to land the writer in the same
 * conversation. What it *wrote* is durable elsewhere — the thread is only what was
 * said.
 */
export type CreatorState = {
  /** The stored conversation, oldest first. */
  thread: CreatorMessage[];
  /** True once the thread has been read — an empty thread and an unread one differ. */
  loaded: boolean;
  /** The ask in flight, painted as a bubble while it runs. `null` when idle. */
  pending: string | null;
  /**
   * The story this chat writes into, or `null` for no world at all.
   *
   * Explicit on purpose: the assistant used to write into whatever story happened
   * to be open, which meant a turn could land in a world the writer was not
   * looking at. Nothing selects this automatically except a story the assistant
   * just created for the turn.
   */
  targetStoryId: string | null;
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
  | { kind: 'new-chat'; characterId: string }
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
  /**
   * The transcript's message filter, as the story panel's `Search messages` row set it.
   *
   * A needle, not a query language: it is matched case-insensitively against a
   * turn's visible text. Empty means no filter. Held in the store rather than in
   * `Transcript` because the control that sets it lives in the other column, and
   * because opening another story has to clear it — a filter that survived a
   * story change would hide the new transcript behind a search nobody typed.
   */
  messageFilter: string;
  /**
   * Whether the transcript is showing its message-search field.
   *
   * The `Search messages` row lives in the story panel and the field lives in the
   * transcript, so "show the field" is chrome state rather than either column's
   * private business — the same reason `rightTab` is here.
   */
  messageSearchOpen: boolean;
  ui: {
    rightTab: RailView;
    drawer: Drawer;
    dialog: Dialog;
    palette: boolean;
    toasts: Toast[];
    /** What was applied to the open story this session. Not persisted. */
    appliedTemplate: AppliedTemplate | null;
  };

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

  /** Read the assistant's stored conversation. */
  loadCreatorThread: () => Promise<void>;
  /**
   * Send one ask to the creation assistant.
   *
   * `allowOverwrite` is the writer's per-request consent to replace a directive
   * block that already has text; without it the server refuses and the receipt
   * says so. The action refreshes everything a turn could have moved — the bundle
   * of the story it wrote into, the cast library, the templates, the story list —
   * so what the page shows after a turn is the database's answer, not the model's
   * claim.
   */
  sendCreator: (input: { text: string; allowOverwrite: boolean }) => Promise<void>;
  /** Stop the turn in flight. Nothing is recorded, and nothing was written. */
  stopCreator: () => void;
  /** Start a new chat: the conversation goes, everything it wrote stays. */
  startNewCreatorChat: () => Promise<void>;
  /** Point the chat at a story, or at no world at all. */
  setCreatorTarget: (storyId: string | null) => void;

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
  /** Record (or clear) the prompt applied to the open story this session. */
  setAppliedTemplate: (applied: AppliedTemplate | null) => void;
  setPage: (page: Page) => void;
  /** Set the transcript's message filter. Empty clears it. */
  setMessageFilter: (filter: string) => void;
  /** Show or hide the transcript's message-search field. */
  setMessageSearchOpen: (open: boolean) => void;
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
