/**
 * Derived reads.
 *
 * These are actions rather than plain selectors because both need two pieces of
 * state that change independently — `activeStory` falls back from the loaded
 * bundle to the story list, and `activeScene` falls back from the chosen scene to
 * the first unarchived one. A component subscribing to both would otherwise have
 * to repeat that precedence, and the two copies would drift.
 */
import type { Store } from '../types.ts';
import type { Slice } from '../slice.ts';
export function gettersSlice({ get, set }: Slice): Pick<Store, 'activeStory' | 'activeScene'> {
  return {
    activeStory: () => {
      const { bundle, activeStoryId, stories } = get();
      if (bundle && bundle.story.id === activeStoryId) return bundle.story;
      return stories.find((item) => item.id === activeStoryId) ?? null;
    },

    activeScene: () => {
      const { bundle, activeSceneId } = get();
      const scenes = bundle?.scenes ?? [];
      const chosen = scenes.find((scene) => scene.id === activeSceneId);
      if (chosen) return chosen;
      return scenes.find((scene) => !scene.archived) ?? scenes[0] ?? null;
    },
  };
}
