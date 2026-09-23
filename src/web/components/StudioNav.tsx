/**
 * The studio's destinations, as a short list.
 *
 * This list used to carry Cast, Creation assistant, Cost & cache, Story
 * settings, Prompt templates, Import & export and Duplicate — seven rows at the
 * same level as the library, which is a concatenation rather than a hierarchy.
 * A writer scanning it for "where do I change the model" learned nothing from
 * the order, and four of the seven are things they touch twice a year.
 *
 * Now it is a directory, and a short one. Everything the old list reached is
 * still reachable — Settings is the hub that files it — and this remains one list
 * rendered in two hosts, so a destination cannot exist in the rail and be missing
 * from the phone's sheet.
 *
 * **Discover is deliberately not in it.** The launcher is a primary control, and
 * it is rendered as its own button above the library by both hosts; repeating it
 * here would be exactly the double-listing this hierarchy exists to remove.
 * `ENTRIES` is therefore the *rest* of the directory, and it is the same four
 * rows minus one that the phone's sheet shows.
 *
 * `onNavigate` is the host's chance to close whatever it is inside. The rail
 * passes nothing; the sheet passes its own close.
 */

import type { ReactElement } from 'react';
import { useStore, type Page } from '../store.ts';
import { IconSettings, IconUsers, IconWand } from './icons.tsx';

type StudioEntry = {
  id: Page;
  label: string;
  hint: string;
  icon: (props: { size?: number }) => ReactElement;
};

const ENTRIES: StudioEntry[] = [
  /* Characters sits beside the launcher as the app-wide library — personas
     included, because "who am I when I talk to them" had no home above a single
     story. */
  { id: 'characters', label: 'Characters', hint: 'your library, and who you are', icon: IconUsers },
  /* The assistant is the same material at an earlier distance: not a roster you
     fill in, but the thing that fills one. */
  { id: 'creator', label: 'Creation assistant', hint: 'a chat that builds characters, lore and worlds', icon: IconWand },
  /* Everything with a knob on it, filed by subject rather than listed flat. */
  { id: 'settings', label: 'Settings', hint: 'cost, prompts, theme, transfer', icon: IconSettings },
];

export function StudioNav({ onNavigate, compact = false }: { onNavigate?: () => void; compact?: boolean }) {
  const setPage = useStore((state) => state.setPage);

  /* The rail shows these as one line each — the list below them is the point,
     and four two-line rows would push it off the first screen. The sheet has
     the room, so it keeps the hints. */
  return (
    <ul className={compact ? 'px-1.5 pt-2' : 'px-1.5'}>
      {ENTRIES.map((entry) => {
        const Icon = entry.icon;
        return (
          <li key={entry.id}>
            <button
              type="button"
              className={
                compact
                  ? 'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--accent-soft)]'
                  : 'flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-[var(--accent-soft)]'
              }
              title={entry.hint}
              onClick={() => {
                setPage(entry.id);
                onNavigate?.();
              }}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border text-accent">
                <Icon size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{entry.label}</span>
                {compact ? null : <span className="block truncate text-[11px] text-faint">{entry.hint}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
