/**
 * Editing turns after they exist.
 *
 * `patchMessage` and `selectVariant` patch optimistically and then adopt the
 * server's row, because the server is authoritative: it clamps `activeVariant`
 * into range and re-lengths `variants`, so a local guess can be wrong in ways the
 * writer would see as a bug. Branches go through the server because a branch is a
 * whole new story carrying this prefix forward.
 */
import { api } from '../../api.ts';
import { patchBundleMessage, replaceMessage } from './helpers.ts';
import type { Store } from '../types.ts';
import type { Slice } from '../slice.ts';
export function messagesSlice({ get, set }: Slice): Pick<Store, 'patchMessage' | 'deleteMessage' | 'selectVariant' | 'branchFrom'> {
  return {
    patchMessage: async (messageId, patch) => {
      patchBundleMessage({ get, set }, messageId, patch);
      try {
        const message = await api.messages.update(messageId, patch);
        // The server clamps `activeVariant` and re-lengths `variants`, so its row
        // is the truth; the optimistic patch above is only there to kill the lag.
        if (get().bundle) set({ bundle: { ...get().bundle!, messages: replaceMessage(get().bundle!.messages, message) } });
      } catch (error) {
        get().fail(error, 'Could not update the message');
        await get().refreshBundle({ quiet: true });
      }
    },

    deleteMessage: async (messageId) => {
      const bundle = get().bundle;
      if (!bundle) return;
      set({ bundle: { ...bundle, messages: bundle.messages.filter((message) => message.id !== messageId) } });
      try {
        await api.messages.remove(messageId);
        void get().refreshPlan({
          storyId: bundle.story.id,
          sceneId: get().activeScene()?.id ?? '',
          mode: 'continue',
        });
      } catch (error) {
        get().fail(error, 'Could not delete the message');
        await get().refreshBundle({ quiet: true });
      }
    },

    selectVariant: async (messageId, index) => {
      patchBundleMessage({ get, set }, messageId, { activeVariant: index });
      try {
        const message = await api.messages.variant(messageId, { index });
        if (get().bundle) set({ bundle: { ...get().bundle!, messages: replaceMessage(get().bundle!.messages, message) } });
      } catch (error) {
        get().fail(error, 'Could not switch variant');
        await get().refreshBundle({ quiet: true });
      }
    },

    branchFrom: async (messageId) => {
      const bundle = get().bundle;
      if (!bundle) return;
      try {
        const story = await api.stories.branch(bundle.story.id, {
          messageId,
          title: `${bundle.story.title} (branch)`,
        });
        set({ stories: [story, ...get().stories] });
        await get().openStory(story.id);
        get().toast({ kind: 'ok', title: 'Branched', detail: `${story.title} carries the cache prefix forward` });
      } catch (error) {
        get().fail(error, 'Could not branch the story');
      }
    },
  };
}
