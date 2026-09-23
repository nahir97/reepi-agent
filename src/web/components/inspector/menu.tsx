/**
 * The story panel's front page.
 *
 * It answers two questions and nothing else: *what is this conversation made of*,
 * and *what can I do with it*.
 *
 * It has been through three shapes. First a seven-tab strip — unreadable in a
 * 21rem column. Then a menu of section rows with live summaries, which was honest
 * but thin: eight pointer rows and a lot of empty panel. Then identity, a payload
 * group, a cost row and five verbs, which was *accurate and cluttered* — the cache
 * discipline is the product's thesis, but a rail that reports on the request is a
 * rail competing with the prose for the same pixels, and the payload analysis has
 * a better home one tap away in the composer that built it.
 *
 * So the payload tooling was moved out rather than deleted. The block-by-block
 * analysis lives behind the composer's own cache pill — the control that measures
 * the payload is the control that shows it — and the prompt library lives in
 * Settings and Story settings, where a writer goes to author one. What is left
 * here is the story's material and its verbs:
 *
 * 1. **Identity** — the card a chat is about, or the story's own shape.
 * 2. **Context** — the material the request is built from. Each row shows up to
 *    three *actual* items — the lore entries, the memories, the scene's state
 *    fields, the cast cards — and when there is nothing it says what to do about
 *    it rather than printing a zero. This is the row set the reference comparison
 *    asked for: world lore lives here, visibly, without a click.
 * 3. **This conversation** — search, rename, duplicate, delete, transfer. Every
 *    row calls an action the app already had.
 *
 * The order of the Context rows is still payload order, so reading them top to
 * bottom is still reading the request top to bottom.
 */

import { useMemo, type ReactElement } from 'react';
import { formatTokens } from '../../../shared/cost.ts';
import type { RightTab } from '../../store.ts';
import { useStore } from '../../store.ts';
import { Avatar } from '../Avatar.tsx';
import {
  IconBook,
  IconBrain,
  IconChevronRight,
  IconClapper,
  IconDownload,
  IconLayers,
  IconPen,
  IconSearch,
  IconTrash,
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

/** The material the request is built from, in payload order. */
export const SECTIONS: Section[] = [
  { id: 'cast', label: 'Cast', hint: 'who is in the scene, and how they speak', icon: IconUsers },
  { id: 'persona', label: 'Persona', hint: 'the card the model reads as you', icon: IconUser },
  { id: 'lore', label: 'Lorebook', hint: 'entries that fire when their keys come up', icon: IconBook },
  { id: 'memory', label: 'Memory', hint: 'facts the story has decided to keep', icon: IconBrain },
  { id: 'scene', label: 'Scene', hint: 'the state the narrator tracks, and its threads', icon: IconLayers },
  { id: 'director', label: 'Director', hint: 'passes, pending notes, running synopsis', icon: IconClapper },
];

/**
 * The section names, so the band can label an open section the way its row does.
 *
 * Exported and still the single source of that wording: two copies of a section's
 * name is how a heading starts disagreeing with the row that was clicked.
 */
export const SECTION_LABEL: Record<RightTab, string> = {
  cast: 'Cast',
  persona: 'Persona',
  lore: 'Lorebook',
  memory: 'Memory',
  scene: 'Scene',
  director: 'Director',
};

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

  if (view === null) return bundle?.story.title ?? 'no story open';
  if (!bundle) return '';

  const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

  const lore = bundle.lore.length;
  const memories = bundle.memories.length;
  const threads = bundle.threads.filter((thread) => thread.status === 'open').length;
  const pending = bundle.notes.filter((note) => !note.accepted).length;
  const stateFields = bundle.scenes.reduce((sum, scene) => sum + scene.state.length, 0);
  const fired = plan?.loreHits.length ?? 0;
  const recalled = plan?.retrieval.length ?? 0;

  const summaries: Record<RightTab, string> = {
    cast: count(bundle.characters.length, 'character'),
    persona: count(bundle.personas.length, 'persona'),
    lore: fired > 0 ? `${lore} entries · ${fired} firing now` : count(lore, 'entry', 'entries'),
    memory: recalled > 0 ? `${memories} facts · ${recalled} recalled now` : count(memories, 'fact'),
    scene: `${count(stateFields, 'state field')} · ${count(threads, 'open thread')}`,
    director: pending > 0 ? count(pending, 'note') + ' waiting' : 'no pending notes',
  };

  return summaries[view];
}

/** A section's first few real rows, so the panel has substance rather than pointers. */
function useSectionItems(view: RightTab, limit: number): { text: string; note?: string }[] {
  const bundle = useStore((state) => state.bundle);
  const plan = useStore((state) => state.plan);

  return useMemo(() => {
    if (!bundle) return [];
    if (view === 'lore') {
      return bundle.lore.slice(0, limit).map((entry) => {
        const firing = plan?.loreHits.some((hit) => hit.entryId === entry.id) ?? false;
        const armed = entry.constant || entry.keys.trim().length > 0;
        return {
          text: entry.title,
          note: firing ? 'firing now' : armed ? 'armed on keys' : 'never fires',
        };
      });
    }
    if (view === 'memory') {
      return bundle.memories.slice(0, limit).map((memory) => ({
        text: memory.text,
        note: memory.subject || memory.kind,
      }));
    }
    if (view === 'scene') {
      const scene = bundle.scenes[0];
      if (!scene) return [];
      return scene.state.slice(0, limit).map((field) => ({ text: field.key, note: field.value }));
    }
    if (view === 'cast') {
      return bundle.characters.slice(0, limit).map((character) => ({
        text: character.name,
        note: `${formatTokens(character.tokens)} tok`,
      }));
    }
    if (view === 'persona') {
      return bundle.personas.slice(0, limit).map((persona) => ({
        text: persona.name,
        note: persona.id === bundle.story.personaId ? 'active — read as you' : persona.isDefault ? 'default' : 'not active',
      }));
    }
    if (view === 'director') {
      return bundle.notes
        .filter((note) => !note.accepted)
        .slice(0, limit)
        .map((note) => ({ text: note.body, note: note.kind }));
    }
    return [];
  }, [bundle, plan, view, limit]);
}

/* -------------------------------------------------------------------- rows */

/** A section row: icon, name, live summary, its own contents, and a chevron. */
function SectionRow({ id }: { id: RightTab }) {
  const section = SECTIONS.find((entry) => entry.id === id);
  const summary = useSectionSummary(id);
  const items = useSectionItems(id, 3);
  const setRightTab = useStore((state) => state.setRightTab);
  if (!section) return null;

  const Icon = section.icon;

  return (
    <li>
      <button
        type="button"
        className="group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
        onClick={() => setRightTab(id)}
        title={section.hint}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-dim">
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium">{section.label}</span>
          <span className="num block truncate text-[10.5px] text-faint">{summary}</span>
        </span>
        <span className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5">
          <IconChevronRight size={12} />
        </span>
      </button>

      {/* The section's own first few rows, so the panel has substance rather than
          pointers. Folded into the row on purpose: it is a preview, and the
          section is one tap away for the whole list. */}
      {items.length > 0 ? (
        <ul className="mt-0.5 mb-1 ml-[2.375rem] space-y-0.5 border-l border-border pl-2.5">
          {items.map((item, index) => (
            <li key={`${id}-${index}`} className="flex items-baseline gap-1.5 text-[10.5px] leading-snug">
              <span className="min-w-0 flex-1 truncate text-dim" title={item.text}>
                {item.text}
              </span>
              {item.note ? <span className="shrink-0 text-faint">{item.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A row that does something, for the conversation verbs. */
function ActionRow({
  label,
  hint,
  icon: Icon,
  run,
  danger = false,
}: {
  label: string;
  hint: string;
  icon: (props: { size?: number }) => ReactElement;
  run: () => void;
  danger?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        className="group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
        onClick={run}
        title={hint}
        style={danger ? { color: 'var(--danger)' } : undefined}
      >
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border"
          style={{ color: danger ? 'var(--danger)' : 'var(--text-dim)' }}
        >
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium">{label}</span>
          <span className="block truncate text-[10.5px] text-faint">{hint}</span>
        </span>
        <span className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5">
          <IconChevronRight size={12} />
        </span>
      </button>
    </li>
  );
}

/** A group's heading inside the menu. */
function GroupLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 px-2 pt-3 pb-1">
      <span className="eyebrow shrink-0">{title}</span>
      {hint ? <span className="num min-w-0 truncate text-[10px] text-faint">{hint}</span> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- menu */

export function InspectMenu() {
  const bundle = useStore((state) => state.bundle);

  if (!bundle) {
    return <p className="p-3 text-[12px] text-faint">Open a story to see what it is made of.</p>;
  }

  return (
    <div className="pb-2">
      <Identity />

      <GroupLabel title="Context" hint="the material the request is built from" />
      <ul className="p-1.5 pt-0">
        {SECTIONS.map((section) => (
          <SectionRow key={section.id} id={section.id} />
        ))}
      </ul>

      <GroupLabel title="This conversation" />
      <ul className="p-1.5 pt-0">
        <ConversationActions />
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- verbs */

/**
 * The conversation's own acts.
 *
 * `Re-measure the payload` and `Warm the cache` used to be here and are gone:
 * both belong to the composer, which is where the writer is when the cost of the
 * next turn is something they can act on. A panel you keep open while reading is
 * the wrong place for a button whose whole meaning is "the request about to be
 * sent".
 */
function ConversationActions() {
  const bundle = useStore((state) => state.bundle);
  const stories = useStore((state) => state.stories);
  const updateStory = useStore((state) => state.updateStory);
  const duplicateStory = useStore((state) => state.duplicateStory);
  const archiveStory = useStore((state) => state.archiveStory);
  const openDialog = useStore((state) => state.openDialog);
  const setMessageSearchOpen = useStore((state) => state.setMessageSearchOpen);

  if (!bundle) return null;
  const story = bundle.story;
  const known = stories.some((candidate) => candidate.id === story.id);

  return (
    <>
      <ActionRow
        label="Search messages"
        hint="filter this conversation's turns, in place"
        icon={IconSearch}
        run={() => setMessageSearchOpen(true)}
      />

      <ActionRow
        label="Rename this conversation"
        hint="the title in the library, and nothing in the payload"
        icon={IconPen}
        run={() => {
          const next = window.prompt('Rename this conversation', story.title);
          const title = next?.trim();
          if (title && title !== story.title) void updateStory({ title });
        }}
      />

      {/* Duplicate and delete are story-level acts the library list also offers.
          They appear here too because the writer looking at *this* conversation is
          the one most likely to want them, and because a panel that only reads is
          a panel you have to leave to act. */}
      <ActionRow
        label="Duplicate this conversation"
        hint="keep this prefix, write a new branch"
        icon={IconDownload}
        run={() => void duplicateStory(story.id)}
      />

      {known ? (
        <ActionRow
          label="Delete this conversation"
          hint="its characters and their conversations are kept"
          icon={IconTrash}
          danger
          run={() => archiveStory(story.id)}
        />
      ) : null}

      <ActionRow
        label="Import & export"
        hint="a bundle, a card, or markdown"
        icon={IconDownload}
        run={() => openDialog({ kind: 'import-export' })}
      />
    </>
  );
}

/* ----------------------------------------------------------------- identity */

/**
 * What this conversation is, at the top of its own panel.
 *
 * A chat leads with its card — the one borrowed character is the whole premise —
 * and a plain story leads with its own shape: title, scene, model, effort. Either
 * way the first thing in the panel answers "what am I looking at", which a menu of
 * section names never did.
 *
 * The buttons are the acts that belong to the *story* rather than to the request:
 * change what it is, or change the prompt it speaks in. The payload blocks are one
 * more click through Story settings, and the template library one more through
 * Prompts — both deliberately, because this panel is not where the cache
 * discipline is managed.
 */
function Identity() {
  const bundle = useStore((state) => state.bundle);
  const stories = useStore((state) => state.stories);
  const activeScene = useStore((state) => state.activeScene);
  const openDialog = useStore((state) => state.openDialog);

  if (!bundle) return null;
  const story = bundle.story;
  const card = story.characterId ? (bundle.characters[0] ?? null) : null;
  const scene = activeScene();
  const chat = stories.find((candidate) => candidate.id === story.id) ?? null;

  if (card) {
    return (
      <div className="border-b border-border p-1.5">
        <div className="flex items-start gap-2.5 rounded-md px-2 py-2" style={{ background: 'var(--bg-sunken)' }}>
          <Avatar name={card.name} src={card.avatar} size="lg" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[13.5px] leading-tight font-semibold">{card.name}</span>
            <span className="mt-0.5 block text-[10.5px] leading-snug text-faint">
              {card.tagline || firstLine(card.description) || 'no tagline yet'}
            </span>
            {chat ? (
              <span className="num mt-1 block text-[10px] text-faint">
                {formatTokens(card.tokens)} tok card{chat.updatedAt > 0 ? ' · this conversation' : ''}
              </span>
            ) : null}
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
            onClick={() => openDialog({ kind: 'new-chat', characterId: card.id })}
          >
            Prompt
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-border p-1.5">
      <div className="flex items-start gap-2.5 rounded-md px-2 py-2" style={{ background: 'var(--bg-sunken)' }}>
        <Avatar name={story.title} src={story.cover} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[13.5px] leading-tight font-semibold">{story.title}</span>
          <span className="num mt-0.5 block text-[10.5px] leading-snug text-faint">
            {scene ? `${scene.title} · ` : ''}
            {story.model === 'deepseek-flash' ? 'Flash' : 'Pro'} · effort {story.effort}
          </span>
          <span className="num mt-1 block text-[10px] text-faint">
            {bundle.characters.length} cast · {bundle.lore.length} lore · {bundle.memories.length} memories
          </span>
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="btn btn-ghost flex-1 justify-center"
          style={{ padding: '0.25rem 0.5rem' }}
          onClick={() => openDialog({ kind: 'story-settings' })}
        >
          <IconPen size={11} />
          Story settings
        </button>
        <button
          type="button"
          className="btn btn-ghost flex-1 justify-center"
          style={{ padding: '0.25rem 0.5rem' }}
          onClick={() => openDialog({ kind: 'prompt-templates' })}
        >
          Prompts
        </button>
      </div>
    </div>
  );
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 72 ? `${line.slice(0, 72)}…` : line;
}
