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
import { THEME_DOT, THEME_LABEL, THEME_ORDER } from '../theme.ts';
import { LibraryList } from './Library.tsx';
import { StudioNav } from './StudioNav.tsx';
import { IconBook, IconChevronDown, IconFlame, IconPlus, IconSnow } from './icons.tsx';

export function Sidebar() {
  const bundle = useStore((state) => state.bundle);
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
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

        {/* One control, not two. A story's own theme is set in its settings
            dialog; this is the studio's. The two prose paragraphs that used to
            explain the difference were longer than the buttons they explained. */}
        <div className="mt-4 flex items-center gap-2 px-3 pt-3">
          <span className="eyebrow shrink-0">Theme</span>
          <div className="flex flex-1 items-center gap-1" role="group" aria-label="Studio theme">
            {THEME_ORDER.map((option) => (
              <button
                key={option}
                type="button"
                className="h-7 flex-1 rounded-md border"
                style={{
                  borderColor: theme === option ? 'var(--accent)' : 'var(--border)',
                  boxShadow: theme === option ? 'inset 0 0 0 1px var(--accent)' : undefined,
                  background: THEME_DOT[option],
                }}
                onClick={() => setTheme(option)}
                aria-pressed={theme === option}
                aria-label={`${THEME_LABEL[option]} theme`}
                title={`${THEME_LABEL[option]} — the whole studio`}
              />
            ))}
          </div>
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
