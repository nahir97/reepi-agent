/**
 * The library: stories, scenes, and the chrome that navigates them.
 *
 * `openStory` is the reset point of the whole app — it clears the plan, bumps the
 * stream generation so any in-flight turn stops painting, and adopts the story's
 * own theme. `refreshBundle({ quiet: true })` is used after every turn and must
 * stay quiet: a spinner there would flicker the transcript mid-stream.
 *
 * `boot` is the only action that reports reachability. If the server is down it
 * records `offline` and still marks itself booted, so the UI can explain the
 * problem instead of hanging on a splash screen.
 */
import { api, describeError, ApiError } from '../../api.ts';
import { IDLE_STREAM } from '../initial.ts';
import { bumpStreamSeq } from '../runtime.ts';
import { applyTheme, persistTheme, storedTheme, isTheme } from '../theme.ts';
import type { Store, Drawer, RightTab, StoryStat, Toast } from '../types.ts';
import { nowId } from './helpers.ts';
import type { Slice } from '../slice.ts';
import type { Story, Scene, Theme } from '../../../shared/types.ts';
import type { StoryTemplateId } from '../../../shared/api.ts';
export function librarySlice({ get, set }: Slice): Pick<Store, 'boot' | 'setTheme' | 'setStoryTheme' | 'loadStories' | 'loadStoryStats' | 'openStory' | 'refreshBundle' |
  'createStory' | 'duplicateStory' | 'archiveStory' | 'updateStory' | 'createScene' | 'switchScene' |
  'updateScene' | 'archiveScene' | 'setRightTab' | 'setDrawer' | 'openDialog' | 'setPalette' | 'toast' |
  'dismissToast' | 'fail'> {
  return {
    boot: async () => {
      const theme = storedTheme();
      const fromDocument = document.documentElement.dataset.theme;
      const resolved = isTheme(fromDocument) ? fromDocument : theme;
      applyTheme(resolved, theme === resolved && document.documentElement.dataset.themeSource === 'manual');
      set({ theme: resolved });
      try {
        await get().loadStories();
        const first = get().stories[0];
        if (first) await get().openStory(first.id);
      } catch (error) {
        set({ offline: describeError(error) });
        get().fail(error, 'Cannot reach the Reepi server');
      }
      set({ booted: true });
      void get().loadStoryStats();
      void get().refreshAccount();
      void get().refreshInsights();
    },

    setTheme: (theme) => {
      persistTheme(theme);
      applyTheme(theme, true);
      set({ theme });
    },

    setStoryTheme: async (storyId, theme) => {
      if (storyId === get().activeStoryId) get().setTheme(theme);
      try {
        const story = await api.stories.setTheme(storyId, theme);
        set({ stories: get().stories.map((item) => (item.id === story.id ? story : item)) });
        const bundle = get().bundle;
        if (bundle && bundle.story.id === story.id) set({ bundle: { ...bundle, story } });
      } catch (error) {
        get().fail(error, 'Could not set the story theme');
      }
    },

    loadStories: async () => {
      const stories = await api.stories.list();
      set({ stories, offline: null });
    },

    loadStoryStats: async () => {
      const { stories } = get();
      const entries = await Promise.all(
        stories.map(async (story): Promise<[string, StoryStat] | null> => {
          try {
            const insights = await api.insights.forStory(story.id);
            return [
              story.id,
              {
                costUsd: insights.totals.costUsd,
                savedUsd: insights.totals.savedUsd,
                words: insights.totals.wordsWritten,
                hitRate: insights.totals.hitRate,
                requests: insights.totals.requests,
              },
            ];
          } catch {
            return null;
          }
        }),
      );
      const storyStats: Record<string, StoryStat> = { ...get().storyStats };
      for (const entry of entries) {
        if (entry) storyStats[entry[0]] = entry[1];
      }
      set({ storyStats });
    },

    openStory: async (storyId) => {
      if (get().activeStoryId === storyId && get().bundle) {
        set({ ui: { ...get().ui, drawer: null } });
        return;
      }
      if (get().streaming.active) get().abort();
      set({ activeStoryId: storyId, loadingBundle: true, plan: null, activeSceneId: null });
      try {
        const bundle = await api.stories.bundle(storyId);
        bumpStreamSeq();
        const firstScene = bundle.scenes.find((scene) => !scene.archived) ?? bundle.scenes[0] ?? null;
        set({
          bundle,
          loadingBundle: false,
          streaming: { ...IDLE_STREAM },
          activeSceneId: firstScene?.id ?? null,
        });
        if (bundle.story.theme !== get().theme) get().setTheme(bundle.story.theme);
        set({ ui: { ...get().ui, drawer: null } });
        void get().refreshInsights();
        void get().refreshPlan({ storyId, sceneId: firstScene?.id ?? '', mode: 'continue' });
      } catch (error) {
        set({ loadingBundle: false });
        get().fail(error, 'Could not open that story');
      }
    },

    /** Re-read the bundle. `quiet` skips the spinner so streaming never flickers. */
    refreshBundle: async (options) => {
      const storyId = get().activeStoryId;
      if (!storyId) return;
      if (!options?.quiet) set({ loadingBundle: true });
      try {
        const bundle = await api.stories.bundle(storyId);
        if (get().activeStoryId !== storyId) return;
        set({ bundle, loadingBundle: false });
        set({ stories: get().stories.map((item) => (item.id === storyId ? bundle.story : item)) });
      } catch (error) {
        set({ loadingBundle: false });
        if (!options?.quiet) get().fail(error, 'Could not refresh the story');
      }
    },

    createStory: async (title, template) => {
      try {
        const story = await api.stories.create({ title, template });
        set({ stories: [story, ...get().stories] });
        await get().openStory(story.id);
        get().toast({ kind: 'ok', title: 'Story created', detail: story.title });
        void get().loadStoryStats();
        return story.id;
      } catch (error) {
        get().fail(error, 'Could not create the story');
        return null;
      }
    },

    duplicateStory: async (storyId) => {
      try {
        const story = await api.stories.duplicate(storyId);
        set({ stories: [story, ...get().stories] });
        get().toast({ kind: 'ok', title: 'Story duplicated', detail: story.title });
        void get().loadStoryStats();
      } catch (error) {
        get().fail(error, 'Could not duplicate the story');
      }
    },

    archiveStory: async (storyId) => {
      const story = get().stories.find((item) => item.id === storyId);
      get().openDialog({
        kind: 'confirm',
        title: `Delete “${story?.title ?? 'this story'}”?`,
        body: 'Every scene, character, memory and cost record for this story goes with it. This cannot be undone.',
        confirmLabel: 'Delete story',
        danger: true,
        run: () => {
          void (async () => {
            try {
              await api.stories.remove(storyId);
              const stories = get().stories.filter((item) => item.id !== storyId);
              set({ stories });
              if (get().activeStoryId === storyId) {
                set({ activeStoryId: null, bundle: null, plan: null, insights: null });
                const next = stories[0];
                if (next) await get().openStory(next.id);
              }
              get().toast({ kind: 'ok', title: 'Story deleted' });
            } catch (error) {
              get().fail(error, 'Could not delete the story');
            }
          })();
        },
      });
    },

    updateStory: async (patch) => {
      const storyId = get().activeStoryId;
      if (!storyId) return;
      try {
        const story = await api.stories.update(storyId, patch);
        const bundle = get().bundle;
        if (bundle) set({ bundle: { ...bundle, story } });
        set({ stories: get().stories.map((item) => (item.id === story.id ? story : item)) });
        void get().refreshPlan({ storyId, sceneId: get().activeScene()?.id ?? '', mode: 'continue' });
      } catch (error) {
        get().fail(error, 'Could not save the story');
      }
    },

    createScene: async (patch) => {
      const storyId = get().activeStoryId;
      if (!storyId) return;
      try {
        const scene = await api.scenes.create(storyId, patch ?? { title: 'New scene' });
        const bundle = get().bundle;
        if (bundle) set({ bundle: { ...bundle, scenes: [...bundle.scenes, scene] } });
        get().toast({ kind: 'ok', title: 'Scene created', detail: scene.title });
      } catch (error) {
        get().fail(error, 'Could not create the scene');
      }
    },

    switchScene: async (sceneId) => {
      const bundle = get().bundle;
      if (!bundle) return;
      const scene = bundle.scenes.find((item) => item.id === sceneId);
      if (!scene) return;
      set({ activeSceneId: sceneId, ui: { ...get().ui, drawer: null } });
      void get().refreshPlan({ storyId: bundle.story.id, sceneId, mode: 'continue' });
    },

    updateScene: async (sceneId, patch) => {
      try {
        const scene = await api.scenes.update(sceneId, patch);
        const bundle = get().bundle;
        if (bundle) {
          set({ bundle: { ...bundle, scenes: bundle.scenes.map((item) => (item.id === scene.id ? scene : item)) } });
        }
      } catch (error) {
        get().fail(error, 'Could not save the scene');
      }
    },

    archiveScene: async (sceneId) => {
      try {
        const scene = await api.scenes.update(sceneId, { archived: true });
        const bundle = get().bundle;
        if (bundle) {
          set({ bundle: { ...bundle, scenes: bundle.scenes.map((item) => (item.id === scene.id ? scene : item)) } });
        }
        get().toast({ kind: 'ok', title: 'Scene archived', detail: scene.title });
      } catch (error) {
        get().fail(error, 'Could not archive the scene');
      }
    },

    setRightTab: (rightTab) => set({ ui: { ...get().ui, rightTab } }),
    setDrawer: (drawer) => set({ ui: { ...get().ui, drawer } }),
    openDialog: (dialog) => set({ ui: { ...get().ui, dialog } }),
    setPalette: (palette) => set({ ui: { ...get().ui, palette } }),

    toast: (toast) => {
      const id = nowId();
      set({ ui: { ...get().ui, toasts: [...get().ui.toasts, { ...toast, id }] } });
      window.setTimeout(() => get().dismissToast(id), toast.kind === 'error' ? 9_000 : 4_500);
    },

    dismissToast: (id) => set({ ui: { ...get().ui, toasts: get().ui.toasts.filter((item) => item.id !== id) } }),

    fail: (error, title = 'Something went wrong') => {
      if (error instanceof ApiError) {
        get().toast({ kind: 'error', title: error.message, ...(error.detail ? { detail: error.detail } : {}) });
        return;
      }
      get().toast({ kind: 'error', title, detail: describeError(error) });
    },
  };
}
