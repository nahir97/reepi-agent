/**
 * The studio destinations.
 *
 * Everything the studio does that is not writing: the cast, the cost ledger, the
 * story's own settings, import/export, and branching a story by duplicating it.
 * The library rail and the phone's navigation sheet both render this one list, so
 * a destination cannot exist in one host and be missing from the other — which is
 * exactly what had happened when only the sheet had them.
 *
 * `onNavigate` is the host's chance to close whatever it is inside. The rail
 * passes nothing; the sheet passes its own close.
 */

import type { ReactElement } from 'react';
import { useStore } from '../store.ts';
import { IconChart, IconCopy, IconDownload, IconSettings, IconTemplate, IconUsers } from './icons.tsx';

type StudioEntry = {
  label: string;
  hint: string;
  icon: (props: { size?: number }) => ReactElement;
  run: () => void;
};

export function StudioNav({ onNavigate, compact = false }: { onNavigate?: () => void; compact?: boolean }) {
  const setPage = useStore((state) => state.setPage);
  const openDialog = useStore((state) => state.openDialog);
  const duplicateStory = useStore((state) => state.duplicateStory);
  const activeStoryId = useStore((state) => state.activeStoryId);

  const entries: StudioEntry[] = [
    /* The cast comes first because it is content rather than instrumentation —
       the one row here that builds the story instead of reporting on it. It opens
       the cast *page*, not the payload rail's Cast section: a writer adding a
       person should not have to reach them through the request that carries them. */
    { label: 'Cast', hint: 'your character library, and this story’s cast', icon: IconUsers, run: () => setPage('cast') },
    /* The ledger, not the command palette. The palette is a way to *reach* things
       — opening it from a row labelled "Cost & cache" made the row a second
       launcher for navigation rather than the destination it named. */
    { label: 'Cost & cache', hint: 'spend, hit rate, what the prefix costs', icon: IconChart, run: () => openDialog({ kind: 'insights' }) },
    { label: 'Story settings', hint: 'model, voice contract, budgets', icon: IconSettings, run: () => openDialog({ kind: 'story-settings' }) },
    /* Templates sit beside Story settings because they are the same material at a
       different distance: one is the blocks of *this* story, the other the text the
       writer reuses across stories. */
    { label: 'Prompt templates', hint: 'reusable system prompts, with macros', icon: IconTemplate, run: () => openDialog({ kind: 'prompt-templates' }) },
    { label: 'Import & export', hint: 'cards, bundles, markdown', icon: IconDownload, run: () => openDialog({ kind: 'import-export' }) },
  ];

  /* Branching is a story-level act, so it only appears when there is a story to
     branch. It duplicates rather than creating an empty one: a copy carries the
     prefix layout that made the original cheap. */
  if (activeStoryId) {
    entries.push({
      label: 'Duplicate story',
      hint: 'keep this prefix, write a new branch',
      icon: IconCopy,
      run: () => void duplicateStory(activeStoryId),
    });
  }

  /* The rail shows these as one line each — the list below them is the point,
     and four two-line rows would push it off the first screen. The sheet has
     the room, so it keeps the hints. */
  return (
    <ul className={compact ? 'px-1.5 pt-2' : 'px-1.5'}>
      {entries.map((entry) => {
        const Icon = entry.icon;
        return (
          <li key={entry.label}>
            <button
              type="button"
              className={
                compact
                  ? 'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--accent-soft)]'
                  : 'flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-[var(--accent-soft)]'
              }
              title={entry.hint}
              onClick={() => {
                entry.run();
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
