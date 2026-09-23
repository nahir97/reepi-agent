/**
 * The library rail.
 *
 * Two bands and one scroller. The band is `.topbar`, the same height as the app
 * header beside it, so the rule under them reads as one line across the window —
 * which is the whole reason the two columns looked like separate applications
 * before.
 *
 * The rail's own story list is `LibraryList`, shared with the phone's navigation
 * sheet. The scene list and the studio theme are here and not there because both
 * are properties of the *open* story: a writer scrolling a list of stories does
 * not also want the scenes of the one they are in.
 */

import { useState } from 'react';
import { useStore } from '../store.ts';
import { LibraryList } from './Library.tsx';
import { StudioNav } from './StudioNav.tsx';
import { IconBook, IconChevronDown, IconCompass, IconFlame, IconPlus, IconSnow } from './icons.tsx';

export function Sidebar() {
  const bundle = useStore((state) => state.bundle);
  const page = useStore((state) => state.page);
  const setPage = useStore((state) => state.setPage);
  const openDialog = useStore((state) => state.openDialog);
  const offline = useStore((state) => state.offline);
  const [scenesOpen, setScenesOpen] = useState(true);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--panel)' }}>
      <header className="topbar pt-safe gap-2 border-b border-border px-3">
        <span className="text-accent">
          <IconBook size={16} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-[15px] leading-none font-semibold tracking-tight">Reepi</h1>
          <p className="eyebrow mt-0.5">Roleplay studio</p>
        </div>
      </header>

      {offline ? (
        <p className="border-b border-border px-3 py-2 text-[11px] leading-snug" style={{ color: 'var(--danger)' }}>
          {offline}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {/* The way in, then the list it is for. `New story` is the one action a
            writer takes before they have anything to write in, so it is the one
            primary button here; Discover is the destination the rail is a résumé
            of, and it is one row rather than a second list. */}
        <div className="space-y-1 px-2 pt-2.5">
          <button
            type="button"
            className="btn btn-primary w-full justify-start gap-2"
            style={{ padding: '0.55rem 0.7rem' }}
            onClick={() => openDialog({ kind: 'new-story' })}
          >
            <IconPlus size={14} />
            New story
          </button>
          <button
            type="button"
            className="btn w-full justify-start gap-2"
            style={{ padding: '0.55rem 0.7rem' }}
            onClick={() => setPage('discover')}
            aria-current={page === 'discover'}
            title="Every conversation and character, one gesture from either"
          >
            <IconCompass size={14} />
            Discover
          </button>
        </div>

        <LibraryList />

        {/* ------------------------------------------------------------ studio */}

        {/* Below the conversations, not above them: the library is the point, and
            these are the things a writer reaches for occasionally. */}
        <div className="mt-4 border-t border-border px-3 pt-3">
          <span className="eyebrow">Studio</span>
        </div>
        <StudioNav compact />

        {/* ------------------------------------------------------------ scenes */}

        {bundle ? (
          <>
            <button
              type="button"
              className="mt-4 flex w-full items-center gap-2 px-3 pt-3 pb-1.5 text-left"
              onClick={() => setScenesOpen((value) => !value)}
              aria-expanded={scenesOpen}
            >
              <span className="eyebrow min-w-0 truncate">Scenes in {bundle.story.title}</span>
              <span className="num shrink-0 text-[10px] text-faint">{bundle.scenes.length}</span>
              <span className={`ml-auto shrink-0 transition-transform ${scenesOpen ? '' : '-rotate-90'}`}>
                <IconChevronDown size={12} />
              </span>
            </button>
            {scenesOpen ? <SceneList /> : null}
          </>
        ) : null}

        {/* ------------------------------------------------------------ theme */}

        {/* One control, not two, and it lives in Settings now. A story's own
            theme is set in its settings dialog; the studio's is a setting, and
            the rail is for navigating and writing rather than for configuring.
            The four swatches there still preview a theme you are not in. */}
        <div className="mt-4 border-t border-border px-3 pt-3">
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            onClick={() => setPage('settings')}
          >
            <span className="eyebrow min-w-0 flex-1 truncate">Studio settings</span>
            <span className="shrink-0 text-[11px] font-medium text-accent">Open</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- scene list */

function SceneList() {
  const bundle = useStore((state) => state.bundle);
  const activeScene = useStore((state) => state.activeScene);
  const switchScene = useStore((state) => state.switchScene);
  const createScene = useStore((state) => state.createScene);
  const archiveScene = useStore((state) => state.archiveScene);
  const openDialog = useStore((state) => state.openDialog);
  const active = activeScene();

  if (!bundle) return null;

  return (
    <ul className="space-y-0.5 px-1.5">
      {bundle.scenes.map((scene) => {
        const turns = bundle.messages.filter((message) => message.sceneId === scene.id).length;
        const isActive = active?.id === scene.id;
        return (
          <li key={scene.id}>
            <div
              className="group flex items-center gap-1.5 rounded-md px-2 py-1.5"
              style={{ background: isActive ? 'var(--bg-sunken)' : 'transparent' }}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => void switchScene(scene.id)}
                aria-current={isActive}
              >
                <span
                  className={`block truncate text-[12.5px] ${isActive ? 'font-semibold' : ''} ${
                    scene.archived ? 'text-faint line-through' : ''
                  }`}
                >
                  {scene.title}
                </span>
                <span className="num text-[10px] text-faint">
                  {turns} turn{turns === 1 ? '' : 's'}
                  {scene.state.length > 0
                    ? ` · ${scene.state.length} state field${scene.state.length === 1 ? '' : 's'}`
                    : ''}
                </span>
              </button>
              {isActive ? (
                <span className="shrink-0" style={{ color: 'var(--accent)' }}>
                  <IconFlame size={11} />
                </span>
              ) : null}
              <button
                type="button"
                className="icon-btn shrink-0 opacity-55 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                style={{ width: 22, height: 22 }}
                disabled={scene.archived}
                onClick={() => {
                  openDialog({
                    kind: 'confirm',
                    title: `Archive “${scene.title}”?`,
                    body: 'The scene stays in the database and its turns stay in the transcript, but it leaves the picker.',
                    confirmLabel: 'Archive scene',
                    danger: false,
                    run: () => void archiveScene(scene.id),
                  });
                }}
                aria-label={`Archive ${scene.title}`}
              >
                <IconSnow size={11} />
              </button>
            </div>
          </li>
        );
      })}
      <li>
        <button type="button" className="btn btn-ghost w-full justify-start" onClick={() => void createScene()}>
          <IconPlus size={12} />
          New scene
        </button>
      </li>
    </ul>
  );
}
