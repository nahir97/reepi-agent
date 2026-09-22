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
 * `story` is the transcript — the product. `cast` replaces the centre column
 * while the writer is building their roster, and `null` means *no page*: the
 * story, which is what every other surface returns to.
 *
 * A page rather than a dialog because a roster needs the window: browsing is
 * scanning, and a 54rem frame over the prose is the wrong shape for it. It only
 * ever replaces the *centre* — the library rail keeps its story list on a wide
 * screen, and the phone gets a back control, so neither loses its way out.
 */
export type Page = 'story' | 'cast';

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
   * Add a card, then open its editor. Living here rather than in the host is what
   * lets the rail's create buttons and the cast page's be one code path instead of
   * two that drift.
   */
  createCard: (card: CardKind) => Promise<void>;

  /**
   * Open this character's 1:1 chat, creating it the first time. A card has at
   * most one chat, so this is "open or start" rather than "create".
   */
  startChatWith: (characterId: string) => Promise<void>;

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
