/**
 * The creation assistant, from the page's side.
 *
 * The turn is a single request: the pass runs its own tool loop server-side and
 * answers with a receipt. Nothing here reimplements any part of that — the slice's
 * whole job is to send the ask, hold the receipt for display, and then **re-read
 * everything the turn could have moved** rather than trusting the receipt's word
 * for it. The receipt says what the assistant intended; the bundle, the cast
 * library, the templates and the payload plan are what actually happened.
 *
 * The log is session-only and in memory. `history` is sent back with each request
 * so a follow-up can say "the second one", but the durable record of a turn is the
 * rows it wrote — which is why a reload loses the conversation and keeps the world.
 */

import { api, describeError } from '../../api.ts';
import { IDLE_CREATOR } from '../initial.ts';
import { nowId } from './helpers.ts';
import type { Slice } from '../slice.ts';
import type { Store } from '../types.ts';
import type { CreatorTurn } from '../types.ts';

export function creatorSlice({ get, set }: Slice): Pick<Store, 'runCreator' | 'clearCreatorLog'> {
  const logWith = (turn: CreatorTurn) => [...get().creator.log, turn];

  return {
    runCreator: async ({ text, allowOverwrite }) => {
      const request = text.trim();
      if (!request || get().creator.busy) return;

      const storyId = get().activeStoryId;
      /* The page's own text, oldest first. Bounded on the server, never trusted
         here — it can influence the side-channel prompt and nothing else. */
      const history = get()
        .creator.log.flatMap((turn) => [
          { role: 'user' as const, content: turn.request },
          ...(turn.reply ? [{ role: 'assistant' as const, content: turn.reply }] : []),
        ]);

      set({ creator: { ...get().creator, busy: true, error: null } });
      try {
        const result = await api.creator({
          request,
          storyId,
          allowOverwrite,
          ...(history.length > 0 ? { history } : {}),
        });

        set({
          creator: {
            log: logWith({
              id: nowId(),
              request,
              reply: result.reply,
              created: result.created,
              updated: result.updated,
              replacedBlocks: result.replacedBlocks,
              refused: result.refused,
              newStoryId: result.newStoryId,
              costUsd: result.costUsd,
              allowOverwrite,
              at: Date.now(),
            }),
            busy: false,
            error: null,
          },
        });

        /* Re-read what the turn could have touched. A new story lands in the
           library rail; a template in the template dialog; a card in the cast
           library; a block in the bundle and therefore in the payload plan. */
        await get().loadStories().catch(() => undefined);
        await get().refreshBundle({ quiet: true });
        await get().refreshCastLibrary();
        await get().loadTemplates();

        /* The plan belongs to the *open* story. A turn that minted a story has not
           opened it, and computing a plan for it here would replace the one the
           writer is looking at with a story they are not in. */
        if (!result.newStoryId && get().activeStoryId) {
          void get().refreshPlan({
            storyId: get().activeStoryId as string,
            sceneId: get().activeScene()?.id ?? '',
            mode: 'continue',
          });
        }
        void get().refreshInsights();
      } catch (error) {
        set({ creator: { ...get().creator, busy: false, error: describeError(error) } });
        get().fail(error, 'The creation assistant failed');
      }
    },

    clearCreatorLog: () => set({ creator: { ...IDLE_CREATOR } }),
  };
}
