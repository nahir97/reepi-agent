/**
 * The turn engine: planning, streaming, and the send/continue/regenerate verbs.
 *
 * `runTurn` is the only place that talks to `/api/chat`. It is built around one
 * invariant — a turn owns a *generation* number. Events from a superseded stream
 * are dropped rather than painted, so opening another story mid-generation cannot
 * bleed one story's prose into another's transcript. The optimistic user row
 * appears immediately; the assistant row keeps the server's real id from the
 * `start` frame, so reconciliation after the turn only ever needs a refresh.
 *
 * `refreshPlan` is the cache meter's input: a genuine dry run that measures the
 * next payload without spending anything. It is advisory, so a failure is
 * swallowed rather than surfaced as an error.
 */

import { api, streamChat } from '../../api.ts';
import { IDLE_STREAM } from '../initial.ts';
import {
  abortActive,
  bumpStreamSeq,
  currentStreamSeq,
  planTimerHandle,
  setActiveController,
  setPlanTimer,
} from '../runtime.ts';
import { ingest } from '../stream.ts';
import type { ChatRequest } from '../../../shared/types.ts';
import type { Slice } from '../slice.ts';
import type { Store } from '../types.ts';
import { localMessage, nowId, pushLocalMessage } from './helpers.ts';

/**
 * One turn, start to finish.
 *
 * Named for its server-side counterpart in `src/server/orchestrator.ts`, which owns
 * the same lifecycle from the other end of the wire. Not exported: the store's
 * public verb is `runTurn` on the slice, and two ways in would be two ways to get
 * the generation bookkeeping wrong.
 */
async function runTurn(slice: Slice, request: ChatRequest): Promise<void> {
  const { get, set } = slice;
  const current = get();
  if (current.streaming.active || !current.bundle) return;

  const scene = current.bundle.scenes.find((item) => item.id === request.sceneId) ?? get().activeScene();
  const sceneId = scene?.id ?? request.sceneId;

  if (request.mode === 'send' && request.text) {
    pushLocalMessage(slice, localMessage(slice, 'user', 'user', request.text, sceneId, nowId()));
  }

  const controller = new AbortController();
  setActiveController(controller);
  const generation = bumpStreamSeq();

  set({
    streaming: { ...IDLE_STREAM, active: true, mode: request.mode, startedAt: Date.now() },
    ui: { ...current.ui, dialog: null, palette: false },
  });

  try {
    await streamChat(
      request,
      {
        onEvent: (event) => {
          if (generation !== currentStreamSeq()) return;
          // Register the assistant row the moment the server names it.
          if (event.type === 'start') {
            const bundle = get().bundle;
            const exists = bundle?.messages.some((message) => message.id === event.messageId) ?? false;
            if (!exists && event.variantIndex === 0) {
              pushLocalMessage(
                slice,
                localMessage(
                  slice,
                  request.mode === 'impersonate' ? 'user' : 'assistant',
                  request.mode === 'continue'
                    ? 'continue'
                    : request.mode === 'impersonate'
                      ? 'impersonate'
                      : 'narrator',
                  '',
                  sceneId,
                  event.messageId,
                ),
              );
            }
          }
          ingest(slice, event);
        },
      },
      controller.signal,
    );
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      get().fail(error, 'Generation failed');
    }
  } finally {
    setActiveController(null);
    if (generation === currentStreamSeq()) {
      const { streaming } = get();
      set({ streaming: { ...streaming, active: false } });
    }
    await get().refreshBundle({ quiet: true });
    void get().refreshInsights();
  }
}

/** Planning, streaming and the turn verbs, bound to the one store. */
export function turnsSlice({ get, set }: Slice): Pick<
  Store,
  'refreshPlan' | 'schedulePlan' | 'runTurn' | 'abort' | 'continueFrom' | 'regenerate' | 'impersonate'
> {
  return {
    refreshPlan: async (request) => {
      if (get().streaming.active) return;
      set({ planBusy: true });
      try {
        const plan = await api.plan(request);
        if (get().activeStoryId === request.storyId) set({ plan });
      } catch {
        // The meter is advisory: a failed dry run must never surface as an error.
      } finally {
        set({ planBusy: false });
      }
    },

    schedulePlan: (request, delayMs = 320) => {
      const existing = planTimerHandle();
      if (existing !== undefined) window.clearTimeout(existing);
      setPlanTimer(
        window.setTimeout(() => {
          setPlanTimer(undefined);
          void get().refreshPlan(request);
        }, delayMs),
      );
    },

    runTurn: (request) => runTurn({ get, set }, request),

    abort: () => {
      abortActive();
      const { streaming } = get();
      set({ streaming: { ...streaming, active: false } });
    },

    continueFrom: async (messageId) => {
      const bundle = get().bundle;
      if (!bundle) return;
      const scene = get().activeScene();
      await runTurn({ get, set }, {
        storyId: bundle.story.id,
        sceneId: scene?.id ?? '',
        mode: 'continue',
        ...(messageId ? { messageId } : {}),
      });
    },

    regenerate: async (messageId) => {
      const bundle = get().bundle;
      if (!bundle) return;
      const scene = get().activeScene();
      await runTurn({ get, set }, {
        storyId: bundle.story.id,
        sceneId: scene?.id ?? '',
        mode: 'regenerate',
        messageId,
      });
    },

    impersonate: async (brief) => {
      const bundle = get().bundle;
      if (!bundle) return;
      const scene = get().activeScene();
      await runTurn({ get, set }, {
        storyId: bundle.story.id,
        sceneId: scene?.id ?? '',
        mode: 'impersonate',
        brief,
      });
    },
  };
}
