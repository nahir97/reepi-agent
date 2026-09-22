/**
 * The creation assistant's conversation, from the page's side.
 *
 * The thread is the server's, not the page's: it is read back on entry and after a
 * turn, so a reload lands the writer in the same conversation with the same
 * receipts. What the page holds is only what has not been recorded yet — the ask
 * in flight, painted as a bubble so the surface feels like a chat rather than a
 * form that locks for thirty seconds.
 *
 * Two things are deliberately explicit here rather than inferred:
 *
 * - **The target story.** It is state the writer sets (or that a just-created story
 *   sets for them), never "whatever story happens to be open". A turn can write
 *   into a world the writer was not looking at only if they pointed it there.
 * - **Stopping.** A stopped turn records nothing and writes nothing, so the page
 *   drops the pending bubble and keeps the writer's text: the sentence they typed
 *   is the one thing an abort must not cost them.
 */

import { api, describeError } from '../../api.ts';
import { IDLE_CREATOR } from '../initial.ts';
import { abortCreator, setCreatorController } from '../runtime.ts';
import type { CreatorMessage } from '../../../shared/types.ts';
import type { Slice } from '../slice.ts';
import type { Store } from '../types.ts';

export function creatorSlice({ get, set }: Slice): Pick<
  Store,
  'loadCreatorThread' | 'sendCreator' | 'stopCreator' | 'startNewCreatorChat' | 'setCreatorTarget'
> {
  /** Append what the server recorded, ignoring a duplicate read. */
  const append = (incoming: CreatorMessage[]): void => {
    const known = new Set(get().creator.thread.map((message) => message.id));
    const fresh = incoming.filter((message) => !known.has(message.id));
    if (fresh.length > 0) set({ creator: { ...get().creator, thread: [...get().creator.thread, ...fresh] } });
  };

  return {
    loadCreatorThread: async () => {
      try {
        const thread = await api.creator.thread();
        set({ creator: { ...get().creator, thread, loaded: true, error: null } });
      } catch (error) {
        /* The page shows the failure beside a retry; the rest of the studio does
           not depend on the thread, so this must not toast on every boot. */
        set({ creator: { ...get().creator, loaded: true, error: describeError(error) } });
      }
    },

    sendCreator: async ({ text, allowOverwrite }) => {
      const request = text.trim();
      const { creator } = get();
      if (!request || creator.pending !== null) return;

      /* The target is captured *now*: a turn must write where it said it would,
         even if the writer changes the picker while it runs. */
      const targetStoryId = creator.targetStoryId;
      const controller = new AbortController();
      setCreatorController(controller);
      set({ creator: { ...creator, pending: request, error: null } });

      try {
        const response = await api.creator.turn(
          {
            request,
            targetStoryId,
            allowOverwrite,
          },
          controller.signal,
        );

        if (response.aborted || !response.turn) {
          /* Stopped: nothing recorded, nothing written. Drop the bubble. */
          set({ creator: { ...get().creator, pending: null } });
          return;
        }

        const { request: asked, reply } = response.turn;
        set({ creator: { ...get().creator, pending: null } });
        append([asked, reply]);

        /* A turn that minted a story becomes the target for the next one: the
           writer just asked for that world, so the obvious follow-up is to keep
           building it. Anything else they say re-points it with the picker. */
        if (reply.targetStoryId && reply.targetStoryId !== get().creator.targetStoryId) {
          set({ creator: { ...get().creator, targetStoryId: reply.targetStoryId } });
        }

        /* Re-read what the turn could have touched. The plan belongs to the *open*
           story, so it is refreshed only when the open story is the one written to. */
        await get().loadStories().catch(() => undefined);
        await get().refreshCastLibrary();
        await get().loadTemplates();
        const open = get().activeStoryId;
        if (open && (!reply.targetStoryId || reply.targetStoryId === open)) {
          await get().refreshBundle({ quiet: true });
          void get().refreshPlan({
            storyId: open,
            sceneId: get().activeScene()?.id ?? '',
            mode: 'continue',
          });
        }
        void get().refreshInsights();
      } catch (error) {
        if (controller.signal.aborted) {
          set({ creator: { ...get().creator, pending: null } });
          return;
        }
        set({ creator: { ...get().creator, pending: null, error: describeError(error) } });
        get().fail(error, 'The creation assistant failed');
      } finally {
        setCreatorController(null);
      }
    },

    stopCreator: () => {
      abortCreator();
      set({ creator: { ...get().creator, pending: null } });
    },

    startNewCreatorChat: async () => {
      if (get().creator.pending !== null) abortCreator();
      try {
        await api.creator.newChat();
        /* A new chat keeps nothing of the old one — including its target, which
           was a statement about the conversation that just ended. */
        set({ creator: { ...IDLE_CREATOR, loaded: true } });
      } catch (error) {
        get().fail(error, 'Could not start a new chat');
      }
    },

    setCreatorTarget: (storyId) => set({ creator: { ...get().creator, targetStoryId: storyId } }),
  };
}
