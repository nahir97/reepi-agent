/**
 * Import and export.
 *
 * Export hands the browser a download rather than holding bytes in state — a
 * full story bundle with inline portraits can be megabytes, and it has no reason
 * to live in memory. Import always lands the writer *in* the new story, because
 * importing and then having to find it in the library would be a worse first
 * impression than the import itself.
 */
import { api, downloadExport } from '../../api.ts';
import { slug } from '../../../shared/text.ts';
import type { Store } from '../types.ts';
import type { Slice } from '../slice.ts';
import type { ExportFormat } from '../../../shared/api.ts';
export function portabilitySlice({ get, set }: Slice): Pick<Store, 'exportStory' | 'importStory'> {
  return {
    exportStory: async (format) => {
      const storyId = get().activeStoryId;
      if (!storyId) return;
      try {
        const story = get().bundle?.story;
        await downloadExport(storyId, format, story ? slug(story.title) : 'reepi');
        get().toast({ kind: 'ok', title: `Exported ${format.toUpperCase()}` });
      } catch (error) {
        get().fail(error, 'Export failed');
      }
    },

    importStory: async (format, data, title) => {
      try {
        const story = await api.importBundle({ format, data, ...(title ? { title } : {}) });
        set({ stories: [story, ...get().stories] });
        await get().openStory(story.id);
        get().toast({ kind: 'ok', title: 'Imported', detail: story.title });
        void get().loadStoryStats();
      } catch (error) {
        get().fail(error, 'Import failed');
      }
    },
  };
}
