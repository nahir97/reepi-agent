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
import type { StoryBundle } from '../../../shared/api.ts';
import { formatPercent, formatTokens } from '../../../shared/cost.ts';
import { EDITABLE_BLOCK_FIELD, filledBlocks, type EditableBlock } from '../../../shared/types.ts';
import type { RightTab } from '../../store.ts';
import { useStore } from '../../store.ts';
import { Avatar } from '../Avatar.tsx';
import {
  IconBook,
  IconBrain,
  IconChart,
  IconChevronRight,
  IconClapper,
  IconLayers,
  IconPen,
  IconScroll,
  IconTemplate,
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

/**
 * The section list, in payload order.
 *
 * Reading it top to bottom is reading the request top to bottom, which is the
 * only way the cache discipline becomes legible. `templates` is the one entry
 * that is not a `BLOCK_ORDER` kind: the prompt is not a block the composer
 * assembles, it is the *text* that ends up in several of them, so it is filed
 * with the payload rather than pretending to be a slice of it.
 */
export const SECTIONS: Section[] = [
  { id: 'blocks', label: 'Payload', hint: 'what the next turn sends, block by block', icon: IconScroll },
  { id: 'templates', label: 'Prompt', hint: 'the saved prompt text shaping this story', icon: IconTemplate },
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
  const templates = useStore((state) => state.promptTemplates);
  const applied = useStore((state) => state.ui.appliedTemplate);

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

  /* How much of the applied prompt is still in the story. Derived from the story's
     own block text against the template's, so it cannot claim a match the payload
     does not have — and a template deleted since it was applied simply stops
     resolving, which reads as "no longer in the library" rather than as a fact
     about this story. */
  const appliedSummary = (): string => {
    if (!applied) return count(templates.length, 'template');
    const template = templates.find((candidate) => candidate.id === applied.templateId);
    if (!template || !bundle) return `“${applied.name}” · applied this session`;
    const blocks = filledBlocks(template);
    const matching = blocks.filter((block) => (template.blocks[block] ?? '') === blockTextOf(bundle, block)).length;
    return matching === blocks.length
      ? `“${applied.name}” · all ${blocks.length} block${blocks.length === 1 ? '' : 's'} match`
      : `“${applied.name}” · ${matching} of ${blocks.length} blocks still match`;
  };

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
    templates: appliedSummary(),
    cast: count(characters, 'character'),
    persona: count(personas, 'persona'),
    lore: fired > 0 ? `${lore} entries · ${fired} firing now` : count(lore, 'entry', 'entries'),
    memory: recalled > 0 ? `${memories} facts · ${recalled} recalled now` : count(memories, 'fact'),
    scene: `${count(stateFields, 'state field')} · ${count(threads, 'open thread')}`,
    director: pending > 0 ? count(pending, 'note') + ' waiting' : 'no pending notes',
  };

  return summaries[view];
}

/** The story field an editable block writes into, read as text. */
function blockTextOf(bundle: StoryBundle, block: EditableBlock): string {
  return String(bundle.story[EDITABLE_BLOCK_FIELD[block]] ?? '');
}

/** The section names, so the band and the menu agree on the wording. */
export const SECTION_LABEL: Record<RightTab, string> = {
  blocks: 'Payload',
  templates: 'Prompt',
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
  const bundle = useStore((state) => state.bundle);

  return (
    <>
      {/* Who you are talking to, at the top of the rail when the session *is* a
          conversation. A story's cast is listed inside the Cast section; a chat's
          one card is the whole premise, so it is stated before the sections
          rather than one level into them. */}
      {bundle?.story.characterId ? <ChatProfile /> : null}

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
    </>
  );
}

/**
 * The card this conversation is about.
 *
 * It is the one thing in a chat that is not a payload section: the character, as
 * the writer knows them. The two controls are the two things a writer does to
 * someone they are talking to — change the card, or look through the roster — and
 * the card itself opens the editor, because a tap on a face is a request to see
 * who that is.
 */
function ChatProfile() {
  const bundle = useStore((state) => state.bundle);
  const openDialog = useStore((state) => state.openDialog);
  const setPage = useStore((state) => state.setPage);

  /* The chat borrows its one card, so the bundle's `characters` holds it. The
     `null` path covers a card deleted out from under a live chat: the
     conversation is still the writer's, it just has nothing to show. */
  const card = bundle?.characters[0] ?? null;
  if (!card) return null;

  return (
    <div className="border-b border-border p-1.5">
      <div className="flex items-start gap-2.5 rounded-md px-2 py-2" style={{ background: 'var(--bg-sunken)' }}>
        <Avatar name={card.name} src={card.avatar} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[13.5px] leading-tight font-semibold">{card.name}</span>
          <span className="mt-0.5 block text-[10.5px] leading-snug text-faint">
            {card.tagline || firstLine(card.description) || 'no tagline yet'}
          </span>
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="btn btn-ghost flex-1 justify-center"
          style={{ padding: '0.25rem 0.5rem' }}
          onClick={() => openDialog({ kind: 'card', card: 'character', id: card.id })}
        >
          <IconPen size={11} />
          Edit card
        </button>
        <button
          type="button"
          className="btn btn-ghost flex-1 justify-center"
          style={{ padding: '0.25rem 0.5rem' }}
          onClick={() => setPage('characters')}
        >
          <IconUsers size={11} />
          Characters
        </button>
        {/* A card has exactly one conversation, so this does not create a second
            one — it offers the card's prompt, which is the one thing a writer
            reaches for while *in* the chat and had no way to reach at all. */}
        <button
          type="button"
          className="btn btn-ghost w-full justify-center"
          style={{ padding: '0.25rem 0.5rem' }}
          onClick={() => openDialog({ kind: 'new-chat', characterId: card.id })}
        >
          <IconTemplate size={11} />
          Prompt for this chat
        </button>
      </div>
    </div>
  );
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 72 ? `${line.slice(0, 72)}…` : line;
}
