/**
 * The section menu: the rail's front page, and the story's control panel.
 *
 * This started as a menu of section rows — one row per payload section, each
 * carrying that section's live summary — and it was better than the seven-tab
 * strip it replaced, because a row can say what it contains and a tab cannot.
 *
 * It was still an *index*, though, and an index is thin: eight rows of "what the
 * next turn sends" next to a lot of empty panel. A writer opening the story panel
 * on a phone to look at the world had to walk into Lorebook to discover it was
 * empty, walk back, and walk into Memory to discover the same. So the front page
 * is now the panel itself:
 *
 * 1. **Identity** — the card this conversation is about, or the story's own
 *    shape. The question "what am I looking at" is answered before anything else.
 * 2. **Context** — the material the payload is built from. Each row shows up to
 *    three *actual* items (the lore entries, the memories, the scene's state
 *    fields, the cast cards), and when there is nothing it says what to do about
 *    it rather than printing a zero. This is the row set the app's own
 *    reference-comparison asked for: world lore lives here, visibly, without a
 *    click.
 * 3. **Payload** — what is being sent and what it costs: the block list with token
 *    weights and volatility, and the prompt that fills it.
 * 4. **This conversation** — the story-level acts that used to be reachable only
 *    from a library row's overflow menu or a Settings page.
 *
 * Ordering is still payload order inside a group, so reading the Context and
 * Payload rows top to bottom is still reading the request top to bottom. The
 * band's summary strings are exported and shared with `Inspector` and the
 * command palette, so a section's heading and its row cannot disagree.
 */

import { useMemo, type ReactElement } from 'react';
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
  IconDownload,
  IconLayers,
  IconPen,
  IconRefresh,
  IconScroll,
  IconSearch,
  IconTemplate,
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
  /** Groups the front page: the material, then what is sent, then the verbs. */
  group: 'context' | 'payload';
};

/**
 * The sections, in payload order.
 *
 * `templates` is the one entry that is not a `BLOCK_ORDER` kind: the prompt is not
 * a block the composer assembles, it is the *text* that ends up in several of
 * them, so it is filed with the payload rather than pretending to be a slice of
 * it.
 */
export const SECTIONS: Section[] = [
  { id: 'blocks', label: 'Payload', hint: 'what the next turn sends, block by block', icon: IconScroll, group: 'payload' },
  { id: 'templates', label: 'Prompt', hint: 'the saved prompt text shaping this story', icon: IconTemplate, group: 'payload' },
  { id: 'cast', label: 'Cast', hint: 'who is in the scene, and how they speak', icon: IconUsers, group: 'context' },
  { id: 'persona', label: 'Persona', hint: 'the card the model reads as you', icon: IconUser, group: 'context' },
  { id: 'lore', label: 'Lorebook', hint: 'entries that fire when their keys come up', icon: IconBook, group: 'context' },
  { id: 'memory', label: 'Memory', hint: 'facts the story has decided to keep', icon: IconBrain, group: 'context' },
  { id: 'scene', label: 'Scene', hint: 'the state the narrator tracks, and its threads', icon: IconLayers, group: 'context' },
  { id: 'director', label: 'Director', hint: 'passes, pending notes, running synopsis', icon: IconClapper, group: 'context' },
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
function blockTextOf(bundle: StoryBundleLite, block: EditableBlock): string {
  return String(bundle.story[EDITABLE_BLOCK_FIELD[block]] ?? '');
}

/** Everything this module needs of a bundle. */
type StoryBundleLite = {
  story: Record<string, unknown>;
};

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

/* -------------------------------------------------------------------- rows */

/**
 * What a section is holding, in the writer's own nouns.
 *
 * Returning items rather than a sentence is what lets the front page show the
 * actual material — the lore entry that is armed, the fact the story decided to
 * keep — instead of a count of things the writer then has to go and find. The
 * list is capped by the caller, not here, so the section view can reuse it in
 * full.
 */
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
      const scene = bundle.scenes.find((candidate) => candidate.id === bundle.story.id) ?? bundle.scenes[0];
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
          eight pointers. Folded into the row on purpose: it is a preview, and the
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

/** A row that goes somewhere or does something, for the conversation verbs. */
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

/* -------------------------------------------------------------------- band */

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
  const openDialog = useStore((state) => state.openDialog);

  if (!bundle) {
    return <p className="p-3 text-[12px] text-faint">Open a story to see what it sends.</p>;
  }

  return (
    <div className="pb-2">
      <Identity />

      <GroupLabel title="Context" hint="the material the request is built from" />
      <ul className="p-1.5 pt-0">
        {SECTIONS.filter((section) => section.group === 'context').map((section) => (
          <SectionRow key={section.id} id={section.id} />
        ))}
      </ul>

      <GroupLabel title="Payload" hint="what the next turn sends, and what it costs" />
      <ul className="p-1.5 pt-0">
        {SECTIONS.filter((section) => section.group === 'payload').map((section) => (
          <SectionRow key={section.id} id={section.id} />
        ))}
        {/* The ledger is a dialog, not a section: it is about money rather than
            about the next request, and it is the one thing here that needs the
            whole window to be readable. */}
        <ActionRow
          label="Cost & cache"
          hint="the ledger · opens as a dialog"
          icon={IconChart}
          run={() => openDialog({ kind: 'insights' })}
        />
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
 * The story-level acts, in the panel rather than in a library row's overflow menu.
 *
 * Rename and export were already reachable — rename through `updateStory` via the
 * settings dialog, export through the transfer dialog — but a writer looking at
 * the panel for "what can I do with this conversation" had to know to look in two
 * other places. Nothing new is invented here: each row calls the action the app
 * already had.
 */
function ConversationActions() {
  const bundle = useStore((state) => state.bundle);
  const stories = useStore((state) => state.stories);
  const updateStory = useStore((state) => state.updateStory);
  const duplicateStory = useStore((state) => state.duplicateStory);
  const archiveStory = useStore((state) => state.archiveStory);
  const openDialog = useStore((state) => state.openDialog);
  const refreshPlan = useStore((state) => state.refreshPlan);
  const activeScene = useStore((state) => state.activeScene);
  const runWarm = useStore((state) => state.runWarm);
  const streaming = useStore((state) => state.streaming.active);
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

      <ActionRow
        label="Re-measure the payload"
        hint="a dry run: builds the exact request, spends nothing"
        icon={IconRefresh}
        run={() =>
          void refreshPlan({ storyId: story.id, sceneId: activeScene()?.id ?? '', mode: 'continue' })
        }
      />

      <ActionRow
        label="Warm the cache"
        hint={
          streaming
            ? 'finish or stop the current turn first'
            : 'pay one deliberate miss so every later turn on this prefix hits'
        }
        icon={IconChart}
        run={() => void runWarm()}
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
                {formatTokens(card.tokens)} tok card · {chat.updatedAt > 0 ? 'this conversation' : 'new'}
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
            <IconTemplate size={11} />
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
          <IconTemplate size={11} />
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
