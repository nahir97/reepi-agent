/**
 * The command palette. Cmd/Ctrl+K.
 *
 * Stories, scenes, inspector sections and the studio's actions in one list,
 * because after a few hours in here the mouse is the slow part. Fully keyboard
 * driven: arrows move, Enter runs, Escape closes.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TEMPLATES, type StoryTemplateId } from '../../shared/api.ts';
import { formatPercent, formatUsd } from '../../shared/cost.ts';
import { useStore, type RightTab } from '../store.ts';
import { SECTIONS, SECTION_LABEL } from './inspector/menu.tsx';
import { IconBook, IconPlus, IconScroll, IconSearch, IconWarm } from './icons.tsx';

type Command = {
  id: string;
  label: string;
  hint: string;
  group: string;
  run: () => void;
};

const SECTION_TABS: { id: RightTab; hint: string }[] = SECTIONS.map((section) => ({
  id: section.id,
  hint: section.hint,
}));

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const stories = useStore((state) => state.stories);
  const stats = useStore((state) => state.storyStats);
  const bundle = useStore((state) => state.bundle);
  const openStory = useStore((state) => state.openStory);
  const switchScene = useStore((state) => state.switchScene);
  const createStory = useStore((state) => state.createStory);
  const openDialog = useStore((state) => state.openDialog);
  const setRightTab = useStore((state) => state.setRightTab);
  const setRailOpen = useStore((state) => state.setRailOpen);
  const setPage = useStore((state) => state.setPage);
  const setDrawer = useStore((state) => state.setDrawer);
  const setTheme = useStore((state) => state.setTheme);
  const runWarm = useStore((state) => state.runWarm);
  const runAgentic = useStore((state) => state.runAgentic);
  const runDiagnose = useStore((state) => state.runDiagnose);
  const refreshInsights = useStore((state) => state.refreshInsights);

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const commands = useMemo<Command[]>(() => {
    /* Opening a section has to work on both layouts: the rail on a wide screen
       (which has to be *open* first) and the drawer on a narrow one. Setting only
       the drawer left this command inert at every width where the rail exists. */
    const openInspector = (tab: RightTab): void => {
      setRightTab(tab);
      setRailOpen(true);
      setDrawer('right');
      onClose();
    };

    const list: Command[] = [
      {
        id: 'new-story',
        label: 'New story',
        hint: 'choose a starting point',
        group: 'Studio',
        run: () => {
          openDialog({ kind: 'new-story' });
          onClose();
        },
      },
      {
        id: 'cast',
        label: 'Cast',
        hint: 'your character library, and this story’s cast',
        group: 'Go',
        run: () => {
          setPage('cast');
          onClose();
        },
      },
      {
        id: 'creator',
        label: 'Creation assistant',
        hint: 'its own chat — ask it to write characters, lore, worlds and templates',
        group: 'Go',
        run: () => {
          setPage('creator');
          onClose();
        },
      },
      {
        id: 'import-export',
        label: 'Import or export',
        hint: 'bundles, character cards, markdown',
        group: 'Studio',
        run: () => {
          openDialog({ kind: 'import-export' });
          onClose();
        },
      },
      {
        id: 'story-settings',
        label: 'Prompt settings',
        hint: 'every block, with token counts',
        group: 'Studio',
        run: () => {
          openDialog({ kind: 'story-settings' });
          onClose();
        },
      },
      {
        id: 'prompt-templates',
        label: 'Prompt templates',
        hint: 'reusable system prompts, with macros',
        group: 'Studio',
        run: () => {
          openDialog({ kind: 'prompt-templates' });
          onClose();
        },
      },
      {
        id: 'warm',
        label: 'Warm the cache',
        hint: 'pay one deliberate miss to make every later turn a hit',
        group: 'Studio',
        run: () => {
          void runWarm();
          onClose();
        },
      },
      {
        id: 'diagnose',
        label: 'Diagnose',
        hint: 'key, payload order, cache smoke test',
        group: 'Studio',
        run: () => {
          void runDiagnose();
          onClose();
        },
      },
      {
        id: 'refresh-insights',
        label: 'Refresh the ledger',
        hint: 're-read cost events',
        group: 'Studio',
        run: () => {
          void refreshInsights();
          onClose();
        },
      },
      {
        id: 'director',
        label: 'Run the Director',
        hint: 'notes on the latest turn, in its own context',
        group: 'Passes',
        run: () => {
          void runAgentic('director');
          onClose();
        },
      },
      {
        id: 'archivist',
        label: 'Run the Archivist',
        hint: 'distil durable memories',
        group: 'Passes',
        run: () => {
          void runAgentic('archivist');
          onClose();
        },
      },
      {
        id: 'summarise',
        label: 'Summarise the trimmed past',
        hint: 'rewrite the synopsis',
        group: 'Passes',
        run: () => {
          void runAgentic('summarise');
          onClose();
        },
      },
      {
        id: 'conductor',
        label: 'Run the Conductor',
        hint: 'three continuations on one cached prefix',
        group: 'Passes',
        run: () => {
          void runAgentic('conductor');
          onClose();
        },
      },
      {
        id: 'insights',
        label: 'Open the cost panel',
        hint: 'spend, savings, hit rate, peak clock',
        group: 'Go',
        run: () => {
          openDialog({ kind: 'insights' });
          onClose();
        },
      },
    ];

    for (const tab of SECTION_TABS) {
      list.push({
        id: `tab-${tab.id}`,
        label: `Inspector · ${SECTION_LABEL[tab.id]}`,
        hint: tab.hint,
        group: 'Go',
        run: () => openInspector(tab.id),
      });
    }

    for (const theme of ['ink', 'ember', 'verdant', 'daylight'] as const) {
      list.push({
        id: `theme-${theme}`,
        label: `Theme · ${theme}`,
        hint: 'switch the studio theme',
        group: 'Go',
        run: () => {
          setTheme(theme);
          onClose();
        },
      });
    }

    for (const scene of bundle?.scenes ?? []) {
      list.push({
        id: `scene-${scene.id}`,
        label: scene.title,
        hint: `${scene.state.length} state fields · switch scene`,
        group: 'Scenes',
        run: () => {
          void switchScene(scene.id);
          onClose();
        },
      });
    }

    for (const story of stories) {
      const stat = stats[story.id];
      list.push({
        id: `story-${story.id}`,
        label: story.title,
        hint: stat
          ? `${formatPercent(stat.hitRate)} cached · ${formatUsd(stat.costUsd)} · ${stat.words} words`
          : 'open this story',
        group: 'Stories',
        run: () => {
          void openStory(story.id);
          onClose();
        },
      });
    }

    for (const [id, entry] of Object.entries(TEMPLATES) as [StoryTemplateId, (typeof TEMPLATES)[StoryTemplateId]][]) {
      list.push({
        id: `template-${id}`,
        label: `New · ${entry.label}`,
        hint: entry.blurb,
        group: 'Templates',
        run: () => {
          void createStory(entry.label, id);
          onClose();
        },
      });
    }

    return list;
  }, [
    bundle,
    stories,
    stats,
    createStory,
    onClose,
    openDialog,
    openStory,
    refreshInsights,
    runAgentic,
    runDiagnose,
    runWarm,
    setDrawer,
    setPage,
    setRailOpen,
    setRightTab,
    setTheme,
    switchScene,
  ]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands.slice(0, 40);
    return commands
      .map((command) => {
        const haystack = `${command.label} ${command.hint} ${command.group}`.toLowerCase();
        const at = haystack.indexOf(needle);
        return { command, score: at === -1 ? Number.POSITIVE_INFINITY : at + command.label.length * 0.01 };
      })
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const grouped = useMemo(() => {
    const order: string[] = [];
    const byGroup: Record<string, Command[]> = {};
    for (const command of matches) {
      if (!byGroup[command.group]) {
        byGroup[command.group] = [];
        order.push(command.group);
      }
      (byGroup[command.group] as Command[]).push(command);
    }
    return order.map((group) => ({ group, items: byGroup[group] as Command[] }));
  }, [matches]);

  const flat = useMemo(() => grouped.flatMap((section) => section.items), [grouped]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((value) => Math.min(flat.length - 1, value + 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((value) => Math.max(0, value - 1));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      flat[index]?.run();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-start justify-center p-4 pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)' }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="animate-rise flex max-h-[70dvh] w-full max-w-[34rem] flex-col overflow-hidden rounded-xl border border-border"
        style={{ background: 'var(--panel-raised)', boxShadow: 'var(--shadow-3)' }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          <span style={{ color: 'var(--text-faint)' }}>
            <IconSearch size={14} />
          </span>
          <label className="sr-only" htmlFor="palette-input">
            Search commands
          </label>
          <input
            id="palette-input"
            ref={input}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
            value={query}
            placeholder="Search stories, scenes, sections, actions…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={flat[index] ? `palette-${flat[index].id}` : undefined}
          />
          <kbd className="chip">esc</kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1" id="palette-list" role="listbox" aria-label="Commands">
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-faint">
              Nothing matches “{query}”. Try a story title, a block name, or “warm”.
            </p>
          ) : null}

          {grouped.map((section) => (
            <div key={section.group}>
              <div className="eyebrow px-3 pt-2 pb-1">{section.group}</div>
              {section.items.map((command) => {
                const position = flat.indexOf(command);
                const active = position === index;
                return (
                  <button
                    key={command.id}
                    id={`palette-${command.id}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
                    style={{ background: active ? 'var(--accent-soft)' : 'transparent' }}
                    onMouseEnter={() => setIndex(position)}
                    onClick={() => command.run()}
                  >
                    <span className="shrink-0" style={{ color: active ? 'var(--accent)' : 'var(--text-faint)' }}>
                      {command.group === 'Stories' ? (
                        <IconBook size={12} />
                      ) : command.group === 'Scenes' ? (
                        <IconScroll size={12} />
                      ) : command.id === 'warm' ? (
                        <IconWarm size={12} />
                      ) : (
                        <IconPlus size={12} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{command.label}</span>
                    <span className="min-w-0 max-w-[52%] truncate text-[10.5px] text-faint">{command.hint}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 text-[10.5px] text-faint">
          <span>
            <kbd className="chip">↑</kbd> <kbd className="chip">↓</kbd> move
          </span>
          <span>
            <kbd className="chip">↵</kbd> run
          </span>
          <span className="ml-auto num">
            {flat.length} of {commands.length}
          </span>
        </div>
      </div>
    </div>
  );
}
