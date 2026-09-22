/**
 * The instruments: cost, diagnosis, warm-up, agentic passes, director notes.
 *
 * Every action here reports its own real cost in the toast, because the point of
 * the panel is that the writer can see what a pass cost at the moment they run
 * it — not in an aggregate an hour later. `runWarm` is the exception that proves
 * the rule: it deliberately spends one miss-priced pass and then *proves* it
 * worked by re-reading the API's own hit accounting.
 */
import { api } from '../../api.ts';
import { formatUsd } from '../../../shared/cost.ts';
import type { Store } from '../types.ts';
import type { Slice } from '../slice.ts';
export function instrumentsSlice({ get, set }: Slice): Pick<Store, 'refreshInsights' | 'refreshAccount' | 'runDiagnose' | 'runWarm' | 'runAgentic' |
  'acceptNote' | 'dismissNote'> {
  return {
    refreshInsights: async (signal) => {
      const storyId = get().activeStoryId;
      try {
        const insights = storyId ? await api.insights.forStory(storyId, signal) : await api.insights.global(signal);
        set({ insights });
      } catch {
        /* the instrument panel is non-critical */
      }
    },

    refreshAccount: async () => {
      try {
        set({ account: await api.refreshAccount() });
      } catch {
        /* no key, no balance — the panel says so */
      }
    },

    runDiagnose: async () => {
      set({ busy: 'diagnose' });
      try {
        set({ diagnose: await api.diagnose(get().activeStoryId) });
        get().toast({ kind: 'ok', title: 'Diagnostics complete' });
      } catch (error) {
        get().fail(error, 'Diagnostics failed');
      } finally {
        set({ busy: null });
      }
    },

    runWarm: async (overrides) => {
      const storyId = get().activeStoryId;
      if (!storyId) return;
      set({ busy: 'warm', warmup: null });
      try {
        const warmup = await api.warm(storyId, overrides);
        set({ warmup });
        get().toast({
          kind: warmup.confirmedHit ? 'ok' : 'info',
          title: warmup.confirmedHit ? 'Prefix is warm' : 'Warm-up ran but saw no hit yet',
          detail: `${warmup.tokens.toLocaleString()} tokens · ${warmup.confirmedHit ? 'second pass served from cache' : 'give the cache a few seconds and retry'}`,
        });
        void get().refreshInsights();
      } catch (error) {
        get().fail(error, 'Warm-up failed');
      } finally {
        set({ busy: null });
      }
    },

    runAgentic: async (pass) => {
      const storyId = get().activeStoryId;
      if (!storyId) return;
      set({ busy: pass });
      try {
        if (pass === 'director') {
          const result = await api.director(storyId);
          await get().refreshBundle({ quiet: true });
          get().toast({
            kind: 'ok',
            title: `Director returned ${result.notes.length} note${result.notes.length === 1 ? '' : 's'}`,
            detail: `${result.threadsOpened.length} thread(s) opened, ${result.stateUpdates.length} state update(s) · ${formatUsd(result.costUsd)}`,
          });
        } else if (pass === 'archivist') {
          const result = await api.archivist(storyId);
          await get().refreshBundle({ quiet: true });
          get().toast({
            kind: 'ok',
            title: `Archivist distilled ${result.memories.length} memor${result.memories.length === 1 ? 'y' : 'ies'}`,
            detail: formatUsd(result.costUsd),
          });
        } else if (pass === 'summarise') {
          const result = await api.summarise(storyId);
          await get().refreshBundle({ quiet: true });
          get().toast({
            kind: 'ok',
            title: 'Synopsis rewritten',
            detail: `${result.synopsis.slice(0, 90)}${result.synopsis.length > 90 ? '…' : ''} · ${formatUsd(result.costUsd)}`,
          });
        } else {
          const result = await api.conductor(storyId, { variants: 3 });
          await get().refreshBundle({ quiet: true });
          get().toast({
            kind: 'ok',
            title: `Conductor drafted ${result.candidates.length} candidates, kept #${result.chosen + 1}`,
            detail: `${result.judgeNote} · ${formatUsd(result.costUsd)}`,
          });
        }
        void get().refreshInsights();
      } catch (error) {
        get().fail(error, `The ${pass} pass failed`);
      } finally {
        set({ busy: null });
      }
    },

    acceptNote: async (noteId) => {
      try {
        const note = await api.notes.accept(noteId);
        const bundle = get().bundle;
        if (bundle) {
          set({ bundle: { ...bundle, notes: bundle.notes.map((item) => (item.id === note.id ? note : item)) } });
        }
      } catch (error) {
        get().fail(error, 'Could not accept the note');
      }
    },

    dismissNote: async (noteId) => {
      const bundle = get().bundle;
      if (!bundle) return;
      set({ bundle: { ...bundle, notes: bundle.notes.filter((item) => item.id !== noteId) } });
      try {
        await api.notes.remove(noteId);
      } catch (error) {
        get().fail(error, 'Could not dismiss the note');
        await get().refreshBundle({ quiet: true });
      }
    },
  };
}
