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
  tips: [],
  notes: [],
  usage: null,
  error: null,
  startedAt: 0,
};

/**
 * The creation assistant's rest state.
 *
 * Also its reset value, for the same reason `IDLE_STREAM` is: the log is a page's
 * memory and "clear" has to mean empty, not "empty except for the turns nobody
 * cleared". The log array is only ever replaced, never appended to in place.
 */
export const IDLE_CREATOR: CreatorState = { log: [], busy: false, error: null };

/**
 * Where the rail's open state is remembered, and how it is read back.
 *
 * Read by `index.html`? No — only the theme is, because only the theme must be
 * applied before first paint. The rail may open a frame late; what it must not do
 * is disagree with the store, so the key and the parser live beside each other.
 */
export const RAIL_KEY = 'reepi.rail';

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
  | 'runCreator'
  | 'clearCreatorLog'
  | 'createCard'
  | 'startChatWith'
  | 'loadCastLibrary'
  | 'refreshCastLibrary'
  | 'addToCast'
  | 'removeFromCast'
  | 'setRightTab'
  | 'setRailOpen'
  | 'setPage'
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
    /* A page's log, not the studio's memory: a reload loses the conversation and
       keeps everything the conversation wrote. */
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
    /* Always the transcript on load. Which page you were on is not worth
       remembering across a reload: the story is the thing you came back for. */
    page: 'story',
    ui: { rightTab: null, drawer: null, dialog: null, palette: false, toasts: [] },
  };
}
