/**
 * The initial state, as a function rather than a frozen object.
 *
 * `create()` runs once, but `storedTheme()` reads `localStorage` — evaluating the
 * initial state at import time would do that before `index.html`'s pre-paint
 * script has settled the document, and would make the module unimportable outside
 * a browser (the server bundle shares this source tree).
 *
 * `IDLE_STREAM` is also the reset value: opening a story or starting a turn spreads
 * a fresh copy of it, so the object itself must never be mutated.
 */

import { storedTheme } from './theme.ts';
import type { CreatorState, Store, StreamingState } from './types.ts';

export const IDLE_STREAM: StreamingState = {
  active: false,
  mode: null,
  messageId: null,
  text: '',
  reasoning: '',
  tools: [],
  passes: [],
  tips: [],
  notes: [],
  usage: null,
  error: null,
  startedAt: 0,
};

/**
 * The creation assistant's rest state.
 *
 * Also its reset value: a new chat has to mean empty, not "empty except for the
 * turns nobody cleared". `targetStoryId` resets to null too — a fresh chat starts
 * with no world selected, which is the honest default and the safe one.
 */
export const IDLE_CREATOR: CreatorState = {
  thread: [],
  loaded: false,
  pending: null,
  targetStoryId: null,
  error: null,
};

/**
 * Where the rail's open state is remembered, and how it is read back.
 *
 * Read by `index.html`? No — only the theme is, because only the theme must be
 * applied before first paint. The rail may open a frame late; what it must not do
 * is disagree with the store, so the key and the parser live beside each other.
 */
export const RAIL_KEY = 'reepi.rail';

/**
 * Where the last opened conversation is remembered.
 *
 * The unit of engagement in Reepi is a conversation, not the app, so a reload
 * should land in the one the writer was in rather than in the newest story the
 * server happens to list first. The value is a story id; an id that no longer
 * resolves (the story was deleted in another tab) falls back to the library, and
 * from there to the launcher.
 *
 * Same key-and-parser-live-beside-each-other rule as the rail above: the writer
 * of the value and the reader of it are one screen apart, so they cannot drift.
 */
export const LAST_STORY_KEY = 'reepi.lastStory';

export function storedRail(): boolean {
  try {
    const raw = window.localStorage.getItem(RAIL_KEY);
    if (raw === 'open') return true;
    if (raw === 'closed') return false;
  } catch {
    /* private mode */
  }
  // Default to closed: the transcript is the product.
  return false;
}

/** The remembered conversation id, or `null`. Never throws in private mode. */
export function storedLastStory(): string | null {
  try {
    return window.localStorage.getItem(LAST_STORY_KEY) || null;
  } catch {
    return null;
  }
}

/** Remember the open conversation. Best-effort: private mode costs a reload. */
export function rememberStory(storyId: string | null): void {
  try {
    if (storyId) window.localStorage.setItem(LAST_STORY_KEY, storyId);
    else window.localStorage.removeItem(LAST_STORY_KEY);
  } catch {
    /* private mode */
  }
}

/** Everything `Store` declares that is data rather than an action. */
export function initialState(): Omit<
  Store,
  | 'boot'
  | 'setTheme'
  | 'setStoryTheme'
  | 'loadStories'
  | 'loadStoryStats'
  | 'openStory'
  | 'refreshBundle'
  | 'createStory'
  | 'duplicateStory'
  | 'archiveStory'
  | 'updateStory'
  | 'loadTemplates'
  | 'saveTemplate'
  | 'removeTemplate'
  | 'loadMacros'
  | 'applyTemplate'
  | 'createScene'
  | 'switchScene'
  | 'updateScene'
  | 'archiveScene'
  | 'loadCreatorThread'
  | 'sendCreator'
  | 'stopCreator'
  | 'startNewCreatorChat'
  | 'setCreatorTarget'
  | 'createCard'
  | 'startChatWith'
  | 'openChatWith'
  | 'newChatWith'
  | 'loadCastLibrary'
  | 'refreshCastLibrary'
  | 'addToCast'
  | 'removeFromCast'
  | 'setRightTab'
  | 'setRailOpen'
  | 'setAppliedTemplate'
  | 'setPage'
  | 'setMessageFilter'
  | 'setMessageSearchOpen'
  | 'setDrawer'
  | 'openDialog'
  | 'setPalette'
  | 'toast'
  | 'dismissToast'
  | 'fail'
  | 'refreshPlan'
  | 'schedulePlan'
  | 'runTurn'
  | 'abort'
  | 'continueFrom'
  | 'regenerate'
  | 'impersonate'
  | 'patchMessage'
  | 'deleteMessage'
  | 'selectVariant'
  | 'branchFrom'
  | 'refreshInsights'
  | 'refreshAccount'
  | 'runDiagnose'
  | 'runWarm'
  | 'runAgentic'
  | 'acceptNote'
  | 'dismissNote'
  | 'exportStory'
  | 'importStory'
  | 'activeStory'
  | 'activeScene'
> {
  return {
    promptTemplates: [],
    macros: [],
    /* The assistant's own conversation, read back from the server. */
    creator: { ...IDLE_CREATOR },
    stories: [],
    storyStats: {},
    activeStoryId: null,
    activeSceneId: null,
    bundle: null,
    castLibrary: null,
    castLibraryError: null,
    loadingBundle: false,
    booted: false,
    offline: null,

    plan: null,
    planBusy: false,

    streaming: { ...IDLE_STREAM },

    insights: null,
    account: null,
    diagnose: null,
    warmup: null,
    busy: null,

    theme: storedTheme(),
    railOpen: storedRail(),
    /* Always the transcript on load — or the launcher, when `boot` finds nothing
       to open. Which page you were on is not worth remembering across a reload;
       which *conversation* you were in is, and that lives in `LAST_STORY_KEY`. */
    page: 'story',
    messageFilter: '',
    messageSearchOpen: false,
    ui: { rightTab: null, drawer: null, dialog: null, palette: false, toasts: [], appliedTemplate: null },
  };
}
