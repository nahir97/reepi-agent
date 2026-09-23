/**
 * Chrome: the app header and the navigation sheet.
 *
 * The header is deliberately thin — a menu, the story's name, one button into the
 * inspector. Everything else the studio can do lives in the navigation sheet,
 * because a phone screen belongs to the prose. The transcript is the product; the
 * controls are behind one tap.
 *
 * The sheet is the *only* route to the library on a small screen, where the rail
 * is hidden, so it leads with the same list the rail shows rather than a
 * summary of it. Its rows are labelled rather than iconic: a phone has no room
 * for a tab bar that says nothing.
 *
 * Both this header and the rail's own band are `.topbar`, so the border under
 * them is one line across the window rather than two of different heights.
 */

import type { ReactElement } from 'react';
import { formatPercent, formatUsd } from '../../shared/cost.ts';
import { useStore, type Page, type RightTab } from '../store.ts';
import { Avatar } from './Avatar.tsx';
import { activePersona } from '../speakers.ts';
import { LibraryList } from './Library.tsx';
import {
  IconBook,
  IconBrain,
  IconClapper,
  IconClose,
  IconLayers,
  IconMenu,
  IconPanelRight,
  IconPen,
  IconPlus,
  IconSettings,
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
  const setPage = useStore((state) => state.setPage);

  return (
    <header className="topbar pt-safe gap-1.5 border-b border-border px-2" style={{ background: 'var(--panel)' }}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setDrawer(drawer === 'nav' ? null : 'nav')}
        aria-expanded={drawer === 'nav'}
        aria-label="Open the menu and library"
      >
        <IconMenu size={17} />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {/* The way out of a conversation, at every width. The rail is hidden
            below `lg` and is not itself a navigation control, so without this the
            launcher would be reachable only by editing the URL. */}
        <button
          type="button"
          className="icon-btn shrink-0"
          onClick={() => setPage('discover')}
          aria-label="Discover — all conversations and characters"
          title="Discover — all conversations and characters"
        >
          <IconBook size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[14px] leading-tight font-semibold">{story?.title ?? 'Reepi'}</h1>
          <p className="num truncate text-[10px] text-faint">
            {streaming
              ? 'writing…'
              : insights
                ? `${formatUsd(insights.totals.savedUsd)} saved · ${formatPercent(insights.totals.hitRate)} cached`
                : 'nothing written yet'}
          </p>
        </div>
      </div>

      {/* Below `xl` the story panel is a drawer, so this is the only control that
          opens it. At `xl` and above the panel is the payload rail, which has its
          own toggle — leaving this visible there produced two identical icons
          stacked in the same corner, the lower one for a drawer that is
          `xl:hidden` and therefore never appeared. */}
      <button
        type="button"
        className="icon-btn xl:hidden"
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

/**
 * The four destinations above the library.
 *
 * This is where the studio's directory lives on a phone, and it is the same four
 * rows `StudioNav` renders in the rail and on the Settings page's Content
 * section — one vocabulary for "where can I go", three hosts.
 */
const DESTINATIONS: { id: Page; label: string; hint: string; icon: (props: { size?: number }) => ReactElement }[] = [
  { id: 'discover', label: 'Discover', hint: 'every conversation and character', icon: IconBook },
  { id: 'characters', label: 'Characters', hint: 'your library, and who you are', icon: IconUsers },
  { id: 'creator', label: 'Creation assistant', hint: 'a chat that builds the world', icon: IconWand },
  { id: 'settings', label: 'Settings', hint: 'cost, prompts, theme, transfer', icon: IconSettings },
];

/* The story's *sections* — what the payload is made of. Characters and personas
   are deliberately absent: they are content a writer builds rather than a slice
   to inspect, and the Characters destination above already names the page that
   builds both. Listing them here as well put two rows named for the same people
   in one sheet, which is the drift the shared list exists to prevent. */
const STORY_ENTRIES: NavEntry[] = [
  { id: 'lore', label: 'World & lore', hint: 'entries that fire when their keys come up', icon: IconBook },
  { id: 'memory', label: 'Memory', hint: 'facts the story has decided to keep', icon: IconBrain },
  { id: 'scene', label: 'Scene', hint: 'title, and the state the narrator tracks', icon: IconLayers },
  { id: 'director', label: 'Director & notes', hint: 'critique, nudges, running synopsis', icon: IconClapper },
];

export function NavSheet() {
  const setDrawer = useStore((state) => state.setDrawer);
  const setRightTab = useStore((state) => state.setRightTab);
  const setPage = useStore((state) => state.setPage);
  const bundle = useStore((state) => state.bundle);
  const switchScene = useStore((state) => state.switchScene);
  const createScene = useStore((state) => state.createScene);
  const activeSceneId = useStore((state) => state.activeSceneId);
  const persona = activePersona(bundle);

  const close = (): void => setDrawer(null);
  /* A section row describes the story's payload, so opening one leaves the cast
     page: the drawer would otherwise cover the roster with a panel about a story
     that is not on screen behind it. */
  const openRight = (tab: RightTab): void => {
    setRightTab(tab);
    setPage('story');
    setDrawer('right');
  };

  const scenes = bundle?.scenes ?? [];

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.5)', border: 0 }}
        onClick={close}
        aria-label="Close the menu"
      />
      <div
        className="animate-slide-in-left absolute inset-y-0 left-0 flex w-[min(90vw,22rem)] flex-col border-r border-border"
        style={{ background: 'var(--panel)', boxShadow: 'var(--shadow-3)' }}
      >
        <div className="topbar pt-safe shrink-0 justify-between border-b border-border px-3">
          <span className="eyebrow">Library</span>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close the menu">
            <IconClose size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-safe">
          {/* The four destinations the rail and the launcher both lead with, in a
              phone's own register: labelled rows with a hint rather than a tab bar
              of icons that say nothing. */}
          <ul className="border-b border-border py-1">
            {DESTINATIONS.map((entry) => {
              const Icon = entry.icon;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--panel-raised)]"
                    onClick={() => {
                      setPage(entry.id);
                      close();
                    }}
                  >
                    <span className="text-accent" aria-hidden="true">
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

          {/* The library itself, in full. A phone's only route to another story. */}
          <LibraryList onPick={close} />

          {/* Who you are. One tap to the persona editor, which is the card the
              model reads as you. */}
          {persona ? (
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2.5 border-y border-border px-3 py-3 text-left"
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

          {/* Scenes. The transcript carries the switcher on a wide screen; on a
              phone this is the only place they are reachable. */}
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
                    close();
                  }}
                >
                  <span className="min-w-0 flex-1 truncate font-display text-[12.5px] font-medium">{scene.title}</span>
                  {scene.archived ? <span className="chip">archived</span> : null}
                </button>
              </li>
            ))}
          </ul>

          {/* Studio destinations used to repeat here. They are the four rows at
              the top of this sheet now, one level up, which is what made this
              list stop being a concatenation: a phone reaches Settings and finds
              the theme, the transfer dialog and the ledger inside it. */}
        </div>
      </div>
    </div>
  );
}
