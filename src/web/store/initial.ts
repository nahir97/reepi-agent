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
import type { Store, StreamingState } from './types.ts';

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
  | 'createScene'
  | 'switchScene'
  | 'updateScene'
  | 'archiveScene'
  | 'setRightTab'
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
    stories: [],
    storyStats: {},
    activeStoryId: null,
    activeSceneId: null,
    bundle: null,
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
    ui: { rightTab: 'blocks', drawer: null, dialog: null, palette: false, toasts: [] },
  };
}
