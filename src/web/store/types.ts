/**
 * The store's vocabulary.
 *
 * Every type the store exposes to the UI lives here, including the `Store`
 * interface itself. Separating it means a component can import the shape of the
 * store without pulling in the store: `import type { Store } from '../store/types.ts'`
 * has no runtime cost and cannot create an import cycle.
 */

import type { AccountInfo, DiagnoseReport, ExportFormat, Insights, StoryBundle, StoryTemplateId, WarmupResult } from '../../shared/api.ts';
import type { ChatRequest, DirectorNote, Message, PayloadPlan, Scene, Story, Theme } from '../../shared/types.ts';

export type RightTab = 'blocks' | 'cast' | 'persona' | 'lore' | 'memory' | 'scene' | 'director';
export type Drawer = 'left' | 'right' | 'nav' | null;

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

export type Dialog =
  | { kind: 'story-settings' }
  | { kind: 'import-export' }
  | { kind: 'new-story' }
  | { kind: 'insights' }
  | { kind: 'card'; card: 'character' | 'persona'; id: string }
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

  /* -------------------------------------------------------------- chrome */
  theme: Theme;
  ui: { rightTab: RightTab; drawer: Drawer; dialog: Dialog; palette: boolean; toasts: Toast[] };

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

  createScene: (patch?: Partial<Scene>) => Promise<void>;
  switchScene: (sceneId: string) => Promise<void>;
  updateScene: (sceneId: string, patch: Partial<Scene>) => Promise<void>;
  archiveScene: (sceneId: string) => Promise<void>;

  setRightTab: (tab: RightTab) => void;
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
