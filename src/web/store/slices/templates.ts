/**
 * Prompt templates, and the macro reference they are written with.
 *
 * A template is app-scoped text; applying it copies that text into the open
 * story. Both halves of that sentence shape this slice: the library is loaded
 * once and kept, and applying goes through `updateStory` — the same PATCH the
 * story editor saves with — so there is exactly one write path into a story's
 * prompt blocks.
 *
 * The macro reference is resolved *by the server*, for the open story, and only
 * refreshed when something that feeds it changes. It is a read model of the same
 * resolver the composer uses, so the value shown beside `{{user}}` is the value
 * the next payload will carry.
 */

import { api } from '../../api.ts';
import {
  templateStoryPatch,
  type EditableBlock,
  type PromptTemplate,
  type Story,
} from '../../../shared/types.ts';
import type { PromptTemplateBody } from '../../../shared/api.ts';
import type { Slice } from '../slice.ts';
import type { Store } from '../types.ts';

export function templatesSlice({ get, set }: Slice): Pick<
  Store,
  'loadTemplates' | 'saveTemplate' | 'removeTemplate' | 'loadMacros' | 'applyTemplate'
> {
  return {
    loadTemplates: async () => {
      try {
        set({ promptTemplates: await api.templates.list() });
      } catch {
        /* Quiet: a missing library costs the writer a dialog, not their session.
           Opening the dialog reports the failure properly. */
        set({ promptTemplates: [] });
      }
    },

    saveTemplate: async (id, body: PromptTemplateBody) => {
      try {
        const saved = id ? await api.templates.update(id, body) : await api.templates.create(body);
        const existing = get().promptTemplates;
        set({
          promptTemplates: existing.some((template) => template.id === saved.id)
            ? existing.map((template) => (template.id === saved.id ? saved : template))
            : [...existing, saved],
        });
        return saved;
      } catch (error) {
        get().fail(error, id ? 'Could not save the template' : 'Could not create the template');
        return null;
      }
    },

    removeTemplate: async (id) => {
      const template = get().promptTemplates.find((candidate) => candidate.id === id);
      try {
        await api.templates.remove(id);
        set({ promptTemplates: get().promptTemplates.filter((candidate) => candidate.id !== id) });
        get().toast({
          kind: 'ok',
          title: 'Template deleted',
          ...(template ? { detail: template.name } : {}),
        });
      } catch (error) {
        get().fail(error, 'Could not delete the template');
      }
    },

    loadMacros: async () => {
      try {
        set({ macros: await api.macros(get().activeStoryId) });
      } catch {
        /* The reference panel degrades to names and hints with no live values. */
        set({ macros: [] });
      }
    },

    applyTemplate: async (template, only) => {
      const bundle = get().bundle;
      if (!bundle) return;
      const patch: Partial<Story> = { ...templateStoryPatch(template.blocks, only) };
      const fields = (Object.keys(patch) as (keyof Story)[]).filter((field) => field !== 'templateId');
      if (fields.length === 0) return;

      /* The link rides with the text, in the same PATCH. Applying a whole template
         makes this story speak that prompt; applying one *block* of it does not, so
         a narrowed apply leaves the link alone rather than claiming a template half
         of which is not in the payload. */
      if (!only) patch.templateId = template.id;

      await get().updateStory(patch);

      /* `updateStory` reports its own failure and swallows it, so the confirmation
         is earned by reading the story back rather than by having called the
         action — a success toast over a failed write is worse than no toast. */
      const story = get().bundle?.story;
      if (!story || !fields.every((field) => story[field] === patch[field])) return;
      if (!only && story.templateId !== template.id) return;

      /* Recorded *after* the read-back, so the rail's Prompt row only ever names a
         template whose text is really in the story. `only` narrows the copy, not
         the record: a single-block apply is reported as such by the match count
         the section derives, which is the honest way to say "partly applied". */
      get().setAppliedTemplate({ templateId: template.id, name: template.name, at: Date.now() });

      get().toast({
        kind: 'ok',
        title: `Applied “${template.name}”`,
        detail: `Overwrote ${fields.length} block${fields.length === 1 ? '' : 's'}: ${fields.join(', ')}.`,
      });
    },
  };
}
