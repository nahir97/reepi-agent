/**
 * The shell.
 *
 * One column of prose, and only the prose. The transcript is the product, so it
 * gets the whole width on a phone and the centre of the screen on a desktop —
 * the library, the payload inspector and the cost ledger are all one deliberate
 * action away, never on stage.
 *
 * Desktop keeps the library rail visible, because switching stories is a
 * navigational act rather than an editorial one. Everything that edits the
 * payload (blocks, cast, persona, lore, memory, scene, director) lives in the
 * inspector rail on a large screen and behind the story button on a small one.
 */

import { useEffect } from 'react';
import { TEMPLATES, type StoryTemplateId } from '../shared/api.ts';
import { useStore } from './store.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { Transcript } from './components/Transcript.tsx';
import { Composer } from './components/Composer.tsx';
import { Inspector } from './components/Inspector.tsx';
import { AppHeader, NavSheet } from './components/MobileBar.tsx';
import { CardEditorDialog, InsightsDialog } from './components/editors.tsx';
import {
  ConfirmDialog,
  ImportExportDialog,
  NewStoryDialog,
  PromptTemplatesDialog,
  StorySettingsDialog,
} from './components/modals.tsx';
import { CastPage } from './components/CastPage.tsx';
import { CreatorPage } from './components/CreatorPage.tsx';
import { Toasts } from './components/toast.tsx';
import { CommandPalette } from './components/palette.tsx';
import { IconFeather, IconPanelRight, IconPlus, IconSearch } from './components/icons.tsx';

const TEMPLATE_IDS = Object.keys(TEMPLATES) as StoryTemplateId[];

export function App() {
  const boot = useStore((state) => state.boot);
  const booted = useStore((state) => state.booted);
  const bundle = useStore((state) => state.bundle);
  const stories = useStore((state) => state.stories);
  const loading = useStore((state) => state.loadingBundle);
  const drawer = useStore((state) => state.ui.drawer);
  const setDrawer = useStore((state) => state.setDrawer);
  const dialog = useStore((state) => state.ui.dialog);
  const openDialog = useStore((state) => state.openDialog);
  const palette = useStore((state) => state.ui.palette);
  const setPalette = useStore((state) => state.setPalette);
  const railOpen = useStore((state) => state.railOpen);
  const setRailOpen = useStore((state) => state.setRailOpen);
  const page = useStore((state) => state.page);

  useEffect(() => {
    void boot();
  }, [boot]);

  /* Cmd/Ctrl+K opens the palette; Cmd/Ctrl+\ toggles the story panel — the rail
     on a wide screen, the drawer on a narrow one. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(!useStore.getState().ui.palette);
      }
      if (event.key === '\\') {
        event.preventDefault();
        if (window.matchMedia('(min-width: 80rem)').matches) {
          const state = useStore.getState();
          state.setRailOpen(!state.railOpen);
        } else {
          const state = useStore.getState();
          state.setDrawer(state.ui.drawer === 'right' ? null : 'right');
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setPalette]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const state = useStore.getState();
      if (state.ui.palette) state.setPalette(false);
      else if (state.ui.drawer) state.setDrawer(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <div className="flex min-h-0 flex-1">
        {/* -------------------------------------------------------- library */}

        <aside className="hidden w-[16.5rem] shrink-0 border-r border-border lg:block" aria-label="Library and scenes">
          <Sidebar />
        </aside>

        {/* --------------------------------------------------------- centre */}

        <main className="flex min-w-0 flex-1 flex-col">
          {page === 'cast' ? (
            <CastPage />
          ) : page === 'creator' ? (
            <CreatorPage />
          ) : (
            <>
              <AppHeader />
              <Transcript />
              <Composer />
            </>
          )}
        </main>

        {/* ------------------------------------------------------ inspector */}

        {/* The payload rail. Genuinely useful, and genuinely not wanted while
            writing — so on a wide screen it collapses to a single button, and
            remembers the choice. Below xl it is a drawer instead. */}
        {railOpen ? (
          <aside className="hidden w-[21rem] shrink-0 border-l border-border xl:flex xl:flex-col" aria-label="Payload inspector">
            <Inspector onClose={() => setRailOpen(false)} />
          </aside>
        ) : (
          <button
            type="button"
            className="hidden w-9 shrink-0 items-start justify-center border-l border-border pt-4 xl:flex"
            style={{ background: 'var(--panel)' }}
            onClick={() => setRailOpen(true)}
            aria-label="Show the payload inspector"
            title="Show the payload inspector — what the next turn will send, and what it costs"
          >
            <span className="text-faint">
              <IconPanelRight size={15} />
            </span>
          </button>
        )}
      </div>

      {/* --------------------------------------------------------- drawers */}

      {drawer === 'nav' ? <NavSheet /> : null}

      {drawer === 'right' ? (
        <div className="fixed inset-0 z-[60] xl:hidden">
          <button
            type="button"
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.55)', border: 0 }}
            onClick={() => setDrawer(null)}
            aria-label="Close the story panel"
          />
          <div
            className="animate-slide-in absolute inset-y-0 right-0 flex w-[min(92vw,24rem)] flex-col border-l border-border"
            style={{ background: 'var(--panel)', boxShadow: 'var(--shadow-3)' }}
          >
            <Inspector onClose={() => setDrawer(null)} />
          </div>
        </div>
      ) : null}

      {/* --------------------------------------------------------- dialogs */}

      {dialog?.kind === 'story-settings' ? <StorySettingsDialog /> : null}
      {dialog?.kind === 'import-export' ? <ImportExportDialog /> : null}
      {dialog?.kind === 'new-story' ? <NewStoryDialog /> : null}
      {dialog?.kind === 'prompt-templates' ? <PromptTemplatesDialog /> : null}
      {dialog?.kind === 'insights' ? <InsightsDialog /> : null}
      {dialog?.kind === 'card' ? <CardEditorDialog kind={dialog.card} id={dialog.id} /> : null}
      {dialog?.kind === 'confirm' ? (
        <ConfirmDialog
          title={dialog.title}
          body={dialog.body}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
          run={dialog.run}
          onClose={() => openDialog(null)}
        />
      ) : null}

      {palette ? <CommandPalette onClose={() => setPalette(false)} /> : null}

      {/* -------------------------------------------------------- onboarding */}

      {booted && !bundle && !loading && page !== 'creator' ? <FirstRun /> : null}

      {!booted ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center" style={{ background: 'var(--bg)' }}>
          <div className="flex flex-col items-center gap-3">
            <span className="animate-pulse-soft" style={{ color: 'var(--accent)' }}>
              <IconFeather size={26} />
            </span>
            <span className="eyebrow">Opening the studio</span>
            <span className="sr-only" role="status">
              Loading Reepi
            </span>
          </div>
        </div>
      ) : null}

      <Toasts />
    </div>
  );
}

/**
 * The first-run screen. It leads with the one fact the product is built on, then
 * gets out of the way — a template, or a name, and nothing else to decide.
 */
function FirstRun() {
  const openDialog = useStore((state) => state.openDialog);
  const createStory = useStore((state) => state.createStory);
  const stories = useStore((state) => state.stories);
  const openStory = useStore((state) => state.openStory);
  const setPage = useStore((state) => state.setPage);

  return (
    <div className="texture-paper fixed inset-0 z-[50] overflow-y-auto lg:static lg:z-auto">
      <div className="animate-rise mx-auto flex min-h-full max-w-[42rem] flex-col justify-center px-6 py-12">
        <div className="eyebrow eyebrow-accent">Reepi</div>
        <h1 className="mt-2 font-display text-[28px] leading-tight sm:text-[36px]">
          Start a story. The first paragraph is the only expensive one.
        </h1>
        <p className="mt-4 max-w-[54ch] font-serif text-[15.5px] leading-[1.72] text-dim">
          Write and roleplay with a cast you build yourself, and watch the cost of remembering drop to almost nothing as
          the story goes on. DeepSeek keeps the front of the request on disk and reads it back at a fiftieth of the
          price — Reepi is built to keep that front intact.
        </p>

        <div className="mt-7">
          <div className="eyebrow mb-2">Pick a starting point</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {TEMPLATE_IDS.map((id) => {
              const entry = TEMPLATES[id];
              return (
                <button
                  key={id}
                  type="button"
                  className="card p-3 text-left transition-colors"
                  onClick={() => void createStory(entry.label, id)}
                >
                  <span className="block font-display text-[14px] font-semibold">{entry.label}</span>
                  <span className="mt-1 block text-[11.5px] leading-snug text-faint">{entry.blurb}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => openDialog({ kind: 'new-story' })}>
            <IconPlus size={13} />
            Name it myself
          </button>
          {/* The assistant is the one surface that works with nothing to open, so
              it is offered where a writer with no story actually stands. */}
          <button type="button" className="btn" onClick={() => setPage('creator')}>
            <IconFeather size={13} />
            Describe it to the assistant
          </button>
          <button type="button" className="btn" onClick={() => openDialog({ kind: 'import-export' })}>
            Import a card or bundle
          </button>
          {stories.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void openStory((stories[0] as { id: string }).id)}
            >
              <IconSearch size={12} />
              Open an existing story
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
