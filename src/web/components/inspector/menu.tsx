/**
 * The section menu: the rail's front page.
 *
 * The rail used to be a seven-tab strip across 21rem. That is a strip nobody
 * reads — the labels were abbreviations of the section names, and none of them
 * could say anything about its own contents, so finding out whether the lorebook
 * had fired cost a click each time either way.
 *
 * This is the same list as a menu: one row per section, each carrying that
 * section's **live summary** — how many characters, how many entries are firing,
 * how much of the payload is frozen. The summary is what makes a level of
 * navigation worth having; without it this would be a worse tab strip.
 *
 * Ordering is payload order, unchanged: reading the list top to bottom is reading
 * the request top to bottom, which is the only way the cache discipline becomes
 * legible.
 */

import type { ReactElement } from 'react';
import { formatPercent, formatTokens } from '../../../shared/cost.ts';
import type { RightTab } from '../../store.ts';
import { useStore } from '../../store.ts';
import {
  IconBook,
  IconBrain,
  IconChart,
  IconChevronRight,
  IconClapper,
  IconLayers,
  IconScroll,
  IconUser,
  IconUsers,
} from '../icons.tsx';

type Section = {
  id: RightTab;
  label: string;
  /** What the section is, for a reader who has not opened it. */
  hint: string;
  icon: (props: { size?: number }) => ReactElement;
};

/** Payload order, which is also the order the composer assembles them in. */
export const SECTIONS: Section[] = [
  { id: 'blocks', label: 'Payload', hint: 'what the next turn sends, block by block', icon: IconScroll },
  { id: 'cast', label: 'Cast', hint: 'who is in the scene, and how they speak', icon: IconUsers },
  { id: 'persona', label: 'Persona', hint: 'the card the model reads as you', icon: IconUser },
  { id: 'lore', label: 'Lorebook', hint: 'entries that fire when their keys come up', icon: IconBook },
  { id: 'memory', label: 'Memory', hint: 'facts the story has decided to keep', icon: IconBrain },
  { id: 'scene', label: 'Scene', hint: 'the state the narrator tracks, and its threads', icon: IconLayers },
  { id: 'director', label: 'Director', hint: 'passes, pending notes, running synopsis', icon: IconClapper },
];

/**
 * The one line under a section's name.
 *
 * Every value comes from the loaded bundle or the measured plan — the same rows
 * the section itself reads. Nothing here is invented client-side, so a summary
 * cannot disagree with the thing it summarises.
 *
 * Exported because the rail's band shows the same string the menu row does; two
 * copies of this arithmetic is exactly how a heading starts contradicting the row
 * that was clicked to reach it.
 */
export function useSectionSummary(view: RightTab | null): string {
  const bundle = useStore((state) => state.bundle);
  const plan = useStore((state) => state.plan);

  const characters = bundle?.characters.length ?? 0;
  const personas = bundle?.personas.length ?? 0;
  const lore = bundle?.lore.length ?? 0;
  const memories = bundle?.memories.length ?? 0;
  const threads = bundle?.threads.filter((thread) => thread.status === 'open').length ?? 0;
  const pending = bundle?.notes.filter((note) => !note.accepted).length ?? 0;
  const stateFields = bundle?.scenes.reduce((sum, scene) => sum + scene.state.length, 0) ?? 0;
  const fired = plan?.loreHits.length ?? 0;
  const recalled = plan?.retrieval.length ?? 0;

  const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

  if (view === null) {
    /* The menu's own band says which story these sections describe. Repeating the
       payload's token count here would print the same string twice — once in the
       band, once in the Payload row directly below it. */
    return bundle?.story.title ?? 'no story open';
  }

  const summaries: Record<RightTab, string> = {
    blocks: plan
      ? `${formatTokens(plan.totalTokens)} tok · ${formatPercent(plan.predictedHitRate)} predicted hit`
      : 'not measured yet',
    cast: count(characters, 'character'),
    persona: count(personas, 'persona'),
    lore: fired > 0 ? `${lore} entries · ${fired} firing now` : count(lore, 'entry', 'entries'),
    memory: recalled > 0 ? `${memories} facts · ${recalled} recalled now` : count(memories, 'fact'),
    scene: `${count(stateFields, 'state field')} · ${count(threads, 'open thread')}`,
    director: pending > 0 ? count(pending, 'note') + ' waiting' : 'no pending notes',
  };

  return summaries[view];
}

/** The section names, so the band and the menu agree on the wording. */
export const SECTION_LABEL: Record<RightTab, string> = {
  blocks: 'Payload',
  cast: 'Cast',
  persona: 'Persona',
  lore: 'Lorebook',
  memory: 'Memory',
  scene: 'Scene',
  director: 'Director',
};

/** A section row: icon, name, live summary, and the chevron that promises a page.
 *
 * The summary hook is called here rather than at the menu level because each row
 * subscribes to what it needs; a hook inside the caller's `.map()` would be
 * conditional by construction, which is the rule a reader would have to reason
 * about every time this list changed. */
function SectionRow({
  id,
  extra,
  onOpen,
}: {
  id: RightTab | null;
  extra?: { label: string; summary: string; hint: string; icon: (props: { size?: number }) => ReactElement };
  onOpen: () => void;
}) {
  const section = id ? SECTIONS.find((entry) => entry.id === id) : undefined;
  const summary = useSectionSummary(id);

  const label = extra?.label ?? section?.label ?? '';
  const hint = extra?.hint ?? section?.hint ?? '';
  const Icon = extra?.icon ?? section?.icon;
  if (!Icon) return null;

  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
      onClick={onOpen}
      title={hint}
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border"
        style={{ color: extra ? 'var(--accent)' : 'var(--text-dim)' }}
      >
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">{label}</span>
        <span className="num block truncate text-[10.5px] text-faint">{extra?.summary ?? summary}</span>
      </span>
      <span className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5">
        <IconChevronRight size={12} />
      </span>
    </button>
  );
}

export function InspectMenu() {
  const setRightTab = useStore((state) => state.setRightTab);
  const openDialog = useStore((state) => state.openDialog);

  return (
    <ul className="p-1.5">
      {SECTIONS.map((section) => (
        <li key={section.id}>
          <SectionRow id={section.id} onOpen={() => setRightTab(section.id)} />
        </li>
      ))}

      {/* The ledger is a dialog, not a section: it is about money rather than
          about the next request, and it is the one thing here that needs the
          whole window to be readable. */}
      <li className="mt-1 border-t border-border pt-1">
        <SectionRow
          id={null}
          extra={{
            label: 'Cost & cache',
            summary: 'the ledger · opens as a dialog',
            hint: 'Spend, savings, hit rate and the peak clock',
            icon: IconChart,
          }}
          onOpen={() => openDialog({ kind: 'insights' })}
        />
      </li>
    </ul>
  );
}
