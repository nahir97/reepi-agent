/**
 * Chrome: the app header and the navigation sheet.
 *
 * The header is deliberately thin — a menu, the story's name, one button into the
 * inspector. Everything else the studio can do lives in the nav sheet, because a
 * phone screen belongs to the prose. The transcript is the product; the controls
 * are behind one tap.
 *
 * The sheet is a real list of labelled rows rather than an icon tab bar: it costs
 * one tap instead of zero, and in exchange every destination can say what it is.
 */

import type { ReactElement } from 'react';
import { formatPercent, formatUsd } from '../../shared/cost.ts';
import type { Theme } from '../../shared/types.ts';
import { useStore, type RightTab } from '../store.ts';
import { THEME_DOT, THEME_LABEL, THEME_ORDER } from '../theme.ts';
import { Avatar } from './Avatar.tsx';
import { activePersona } from '../speakers.ts';
import {
  IconBook,
  IconBrain,
  IconChart,
  IconClapper,
  IconClose,
  IconCopy,
  IconDownload,
  IconLayers,
  IconMenu,
  IconPanelRight,
  IconPen,
  IconPlus,
  IconSettings,
  IconUser,
  IconUsers,
  IconWand,
} from './icons.tsx';


export function AppHeader() {
  const setDrawer = useStore((state) => state.setDrawer);
  const drawer = useStore((state) => state.ui.drawer);
  const story = useStore((state) => state.activeStory());
  const insights = useStore((state) => state.insights);
  const streaming = useStore((state) => state.streaming.active);
  const setRightTab = useStore((state) => state.setRightTab);

  return (
    <header
      className="pt-safe flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-2"
      style={{ background: 'var(--panel)' }}
    >
      <button
        type="button"
        className="icon-btn"
        onClick={() => setDrawer(drawer === 'nav' ? null : 'nav')}
        aria-expanded={drawer === 'nav'}
        aria-label="Open the menu"
      >
        <IconMenu size={17} />
      </button>

      <div className="min-w-0 flex-1 text-center lg:text-left">
        <h1 className="truncate font-display text-[14px] leading-tight font-semibold">{story?.title ?? 'Reepi'}</h1>
        <p className="num truncate text-[10px] text-faint">
          {streaming
            ? 'writing…'
            : insights
              ? `${formatUsd(insights.totals.savedUsd)} saved · ${formatPercent(insights.totals.hitRate)} cached`
              : 'nothing written yet'}
        </p>
      </div>

      <button
        type="button"
        className="icon-btn"
        onClick={() => {
          setRightTab('cast');
          setDrawer(drawer === 'right' ? null : 'right');
        }}
        aria-expanded={drawer === 'right'}
        aria-label="Open the story panel"
      >
        <IconPanelRight size={17} />
      </button>
    </header>
  );
}

/* --------------------------------------------------------------------- sheet */

type NavEntry = { id: RightTab; label: string; hint: string; icon: (props: { size?: number }) => ReactElement };

const STORY_ENTRIES: NavEntry[] = [
  { id: 'cast', label: 'Characters', hint: 'who is in the scene, and how they speak', icon: IconUsers },
  { id: 'persona', label: 'Your personas', hint: 'who you are in this story', icon: IconUser },
  { id: 'lore', label: 'World & lore', hint: 'entries that fire when their keys come up', icon: IconBook },
  { id: 'memory', label: 'Memory', hint: 'facts the story has decided to keep', icon: IconBrain },
  { id: 'scene', label: 'Scene', hint: 'title, and the state the narrator tracks', icon: IconLayers },
  { id: 'director', label: 'Director & notes', hint: 'critique, nudges, running synopsis', icon: IconClapper },
];

export function NavSheet() {
  const setDrawer = useStore((state) => state.setDrawer);
  const setRightTab = useStore((state) => state.setRightTab);
  const openDialog = useStore((state) => state.openDialog);
  const bundle = useStore((state) => state.bundle);
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
  const duplicateStory = useStore((state) => state.duplicateStory);
  const activeStoryId = useStore((state) => state.activeStoryId);
  const switchScene = useStore((state) => state.switchScene);
  const createScene = useStore((state) => state.createScene);
  const activeSceneId = useStore((state) => state.activeSceneId);
  const setPalette = useStore((state) => state.setPalette);
  const persona = activePersona(bundle);

  const openRight = (tab: RightTab): void => {
    setRightTab(tab);
    setDrawer('right');
  };

  const scenes = bundle?.scenes ?? [];

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.5)', border: 0 }}
        onClick={() => setDrawer(null)}
        aria-label="Close the menu"
      />
      <div
        className="animate-slide-in-left absolute inset-y-0 left-0 flex w-[min(86vw,21rem)] flex-col border-r border-border"
        style={{ background: 'var(--panel)', boxShadow: 'var(--shadow-3)' }}
      >
        <div className="pt-safe flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
          <span className="eyebrow">Menu</span>
          <button type="button" className="icon-btn" onClick={() => setDrawer(null)} aria-label="Close the menu">
            <IconClose size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-safe">
          {/* Who you are. One tap to the persona editor, which is the card the
              model reads as you — worth surfacing above everything else. */}
          {persona ? (
            <button
              type="button"
              className="flex w-full items-center gap-2.5 border-b border-border px-3 py-3 text-left"
              onClick={() => openRight('persona')}
            >
              <Avatar name={persona.name} src={persona.avatar} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[13px] font-semibold">{persona.name}</span>
                <span className="block truncate text-[11px] text-faint">
                  {persona.description ? 'your persona' : 'add a description — it shapes every turn'}
                </span>
              </span>
              <IconPen size={13} className="text-faint" />
            </button>
          ) : null}

          <div className="px-3 pt-3 pb-1">
            <span className="eyebrow">This story</span>
          </div>
          <ul>
            {STORY_ENTRIES.map((entry) => {
              const Icon = entry.icon;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--panel-raised)]"
                    onClick={() => openRight(entry.id)}
                  >
                    <span className="text-accent">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{entry.label}</span>
                      <span className="block truncate text-[11px] text-faint">{entry.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Scenes. The transcript no longer carries a switcher, so this is the
              one place they are reachable on a phone. */}
          <div className="flex items-center gap-2 border-t border-border px-3 pt-3 pb-1">
            <span className="eyebrow">Scenes</span>
            <span className="num text-[10px] text-faint">{scenes.length}</span>
            <button
              type="button"
              className="icon-btn ml-auto"
              style={{ width: 22, height: 22 }}
              onClick={() => void createScene({ title: `Scene ${scenes.length + 1}` })}
              aria-label="New scene"
            >
              <IconPlus size={12} />
            </button>
          </div>
          <ul className="px-2">
            {scenes.map((scene) => (
              <li key={scene.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left"
                  style={{
                    background: scene.id === activeSceneId ? 'var(--accent-soft)' : 'transparent',
                    color: scene.id === activeSceneId ? 'var(--accent)' : 'var(--text)',
                  }}
                  onClick={() => {
                    void switchScene(scene.id);
                    setDrawer(null);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate font-display text-[12.5px] font-medium">
                    {scene.title}
                  </span>
                  {scene.archived ? <span className="chip">archived</span> : null}
                </button>
              </li>
            ))}
          </ul>

          {/* The instrument panel, kept last because it is the one thing you
              rarely want while writing. */}
          <div className="mt-1 border-t border-border px-3 pt-3 pb-1">
            <span className="eyebrow">Studio</span>
          </div>
          <ul>
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--panel-raised)]"
                onClick={() => {
                  setDrawer(null);
                  setPalette(true);
                }}
              >
                <span className="text-accent">
                  <IconWand size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">Cost & cache</span>
                  <span className="block truncate text-[11px] text-faint">
                    spend, hit rate, what the prefix costs
                  </span>
                </span>
                <IconChart size={13} className="text-faint" />
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--panel-raised)]"
                onClick={() => {
                  setDrawer(null);
                  openDialog({ kind: 'story-settings' });
                }}
              >
                <span className="text-accent">
                  <IconSettings size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">Story settings</span>
                  <span className="block truncate text-[11px] text-faint">model, voice contract, budgets</span>
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--panel-raised)]"
                onClick={() => {
                  setDrawer(null);
                  openDialog({ kind: 'import-export' });
                }}
              >
                <span className="text-accent">
                  <IconDownload size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">Import & export</span>
                  <span className="block truncate text-[11px] text-faint">cards, bundles, markdown</span>
                </span>
              </button>
            </li>
            {activeStoryId ? (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--panel-raised)]"
                  onClick={() => {
                    setDrawer(null);
                    void duplicateStory(activeStoryId);
                  }}
                >
                  <span className="text-accent">
                    <IconCopy size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">Duplicate story</span>
                    <span className="block truncate text-[11px] text-faint">keep this prefix, write a new branch</span>
                  </span>
                </button>
              </li>
            ) : null}
          </ul>

          <div className="border-t border-border px-3 pt-3 pb-4">
            <span className="eyebrow">Theme</span>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {THEME_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="flex items-center gap-2 rounded-md border px-2 py-2 text-left text-[12px]"
                  style={{
                    borderColor: theme === id ? 'var(--accent)' : 'var(--border)',
                    background: theme === id ? 'var(--accent-soft)' : 'transparent',
                  }}
                  onClick={() => setTheme(id)}
                  aria-pressed={theme === id}
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-border"
                    style={{ background: THEME_DOT[id] }}
                    aria-hidden="true"
                  />
                  {THEME_LABEL[id]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
