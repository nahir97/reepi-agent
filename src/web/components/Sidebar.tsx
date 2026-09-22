/**
 * The library rail.
 *
 * Story list with its cost badges, the scene list for the open story, the
 * per-story theme picker, and the template chooser. The cost badge is not
 * decoration: choosing which story to work on is partly choosing which cache is
 * already warm.
 */

import { useMemo, useState } from 'react';
import { formatPercent, formatTokens, formatUsd } from '../../shared/cost.ts';
import { TEMPLATES, type StoryTemplateId } from '../../shared/api.ts';
import type { Story, Theme } from '../../shared/types.ts';
import { MODELS } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { THEME_COVER as COVER, THEME_DOT, THEME_LABEL, THEME_ORDER } from '../theme.ts';
import {
  IconBook,
  IconChevronDown,
  IconClose,
  IconCopy,
  IconFlame,
  IconPlus,
  IconSnow,
  IconTrash,
  IconUpload,
} from './icons.tsx';


export function Sidebar() {
  const stories = useStore((state) => state.stories);
  const stats = useStore((state) => state.storyStats);
  const activeStoryId = useStore((state) => state.activeStoryId);
  const bundle = useStore((state) => state.bundle);
  const openStory = useStore((state) => state.openStory);
  const createStory = useStore((state) => state.createStory);
  const duplicateStory = useStore((state) => state.duplicateStory);
  const archiveStory = useStore((state) => state.archiveStory);
  const openDialog = useStore((state) => state.openDialog);
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
  const offline = useStore((state) => state.offline);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<StoryTemplateId>('hollow-court');
  const [scenesOpen, setScenesOpen] = useState(true);

  const sorted = useMemo(
    () => [...stories].sort((a, b) => b.updatedAt - a.updatedAt),
    [stories],
  );

  const submit = async (): Promise<void> => {
    const chosen = title.trim() || TEMPLATES[template].seed.title || 'Untitled Story';
    await createStory(chosen, template);
    setTitle('');
    setCreating(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--panel)' }}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3">
        <span className="text-accent">
          <IconBook size={16} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-[15px] leading-none font-semibold tracking-tight">Reepi</h1>
          <p className="eyebrow mt-0.5">Roleplay studio</p>
        </div>
        <button
          type="button"
          className="icon-btn ml-auto"
          onClick={() => setCreating((value) => !value)}
          aria-expanded={creating}
          aria-label="New story"
          title="New story"
        >
          {creating ? <IconClose size={14} /> : <IconPlus size={14} />}
        </button>
      </header>

      {offline ? (
        <p className="border-b border-border px-3 py-2 text-[11px] leading-snug" style={{ color: 'var(--danger)' }}>
          {offline}
        </p>
      ) : null}

      {creating ? (
        <NewStoryPanel
          title={title}
          template={template}
          onTitle={setTitle}
          onTemplate={setTemplate}
          onSubmit={() => void submit()}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {/* ------------------------------------------------------------ stories */}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
          <span className="eyebrow">Library</span>
          <span className="num text-[10px] text-faint">{stories.length}</span>
        </div>

        {stories.length === 0 ? (
          <p className="px-3 py-2 text-[12px] leading-snug text-faint">
            No stories yet. Start from a template — the contract, genre and style come pre-filled, and those are the
            blocks you least want to keep editing.
          </p>
        ) : (
          <ul className="space-y-0.5 px-1.5">
            {sorted.map((story) => (
              <StoryRow
                key={story.id}
                story={story}
                active={story.id === activeStoryId}
                stat={stats[story.id]}
                onOpen={() => void openStory(story.id)}
                onDuplicate={() => void duplicateStory(story.id)}
                onDelete={() => archiveStory(story.id)}
                onSettings={() => openDialog({ kind: 'story-settings' })}
              />
            ))}
          </ul>
        )}

        {/* ------------------------------------------------------------- scenes */}

        {bundle ? (
          <>
            <button
              type="button"
              className="mt-4 flex w-full items-center gap-2 px-3 pt-3 pb-1.5 text-left"
              onClick={() => setScenesOpen((value) => !value)}
              aria-expanded={scenesOpen}
            >
              <span className="eyebrow">Scenes</span>
              <span className="num text-[10px] text-faint">{bundle.scenes.length}</span>
              <span className={`ml-auto transition-transform ${scenesOpen ? '' : '-rotate-90'}`}>
                <IconChevronDown size={12} />
              </span>
            </button>
            {scenesOpen ? <SceneList /> : null}
          </>
        ) : null}

        {/* ---------------------------------------------------------- theme */}

        {/* One control, not two. A story's own theme is set in its settings
            dialog; this is the studio's. The two prose paragraphs that used to
            explain the difference were longer than the buttons they explained. */}
        <div className="mt-4 flex items-center gap-2 px-3 pt-3 pb-4">
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
          <button
            type="button"
            className="icon-btn shrink-0"
            style={{ width: 26, height: 26 }}
            onClick={() => openDialog({ kind: 'import-export' })}
            aria-label="Import or export a story"
            title="Import or export"
          >
            <IconUpload size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function StoryRow({
  story,
  active,
  stat,
  onOpen,
  onDuplicate,
  onDelete,
  onSettings,
}: {
  story: Story;
  active: boolean;
  stat: { costUsd: number; savedUsd: number; words: number; hitRate: number; requests: number } | undefined;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSettings: () => void;
}) {
  return (
    <li>
      <div
        className="group flex items-start gap-2 rounded-md px-2 py-2"
        style={{
          background: active ? 'var(--accent-soft)' : 'transparent',
          boxShadow: active ? 'inset 2px 0 0 var(--accent)' : undefined,
        }}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 h-8 w-1.5 shrink-0 rounded-full"
          style={{ background: COVER[story.theme] }}
        />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen} aria-current={active}>
          <span className="block truncate font-display text-[13.5px] leading-tight font-semibold">{story.title}</span>
          <span className="num mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] text-faint">
            {stat ? (
              <>
                <span>{formatTokens(stat.words)}w</span>
                <span aria-hidden="true">·</span>
                <span style={{ color: 'var(--accent)' }}>{formatUsd(stat.costUsd)}</span>
                {stat.requests > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span style={{ color: stat.hitRate >= 0.7 ? 'var(--cache-hit)' : 'var(--cache-miss)' }}>
                      {formatPercent(stat.hitRate)} hit
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              <span>{MODELS[story.model].label}</span>
            )}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={onSettings}
            aria-label={`Prompt settings for ${story.title}`}
            title="Prompt settings"
          >
            <IconBook size={11} />
          </button>
          <button
            type="button"
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={onDuplicate}
            aria-label={`Duplicate ${story.title}`}
            title="Duplicate — carries the cache prefix layout"
          >
            <IconCopy size={11} />
          </button>
          <button
            type="button"
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={onDelete}
            aria-label={`Delete ${story.title}`}
            title="Delete"
          >
            <IconTrash size={11} />
          </button>
        </div>
      </div>
    </li>
  );
}

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
                  {scene.state.length > 0 ? ` · ${scene.state.length} state field${scene.state.length === 1 ? '' : 's'}` : ''}
                </span>
              </button>
              {isActive ? (
                <span className="shrink-0" style={{ color: 'var(--accent)' }}>
                  <IconFlame size={11} />
                </span>
              ) : null}
              <button
                type="button"
                className="icon-btn shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
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

/* ---------------------------------------------------------------- new story */

export type NewStoryPanelProps = {
  title: string;
  template: StoryTemplateId;
  onTitle: (value: string) => void;
  onTemplate: (value: StoryTemplateId) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

/**
 * The inline template chooser in the library rail. Blurbs come from the server's
 * own `TEMPLATES`, so the thing described is exactly the prefix the composer
 * will build.
 */
export function NewStoryPanel({ title, template, onTitle, onTemplate, onSubmit, onCancel }: NewStoryPanelProps) {
  const ids = Object.keys(TEMPLATES) as StoryTemplateId[];

  return (
    <form
      className="animate-rise shrink-0 border-b border-border px-3 py-3"
      style={{ background: 'var(--bg-sunken)' }}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="eyebrow eyebrow-accent mb-1.5">New story</div>
      <label className="label" htmlFor="new-story-title">
        Title
      </label>
      <input
        id="new-story-title"
        className="field field-sm"
        value={title}
        autoFocus
        placeholder="blank uses the template's own"
        onChange={(event) => onTitle(event.target.value)}
      />

      <fieldset className="mt-2.5">
        <legend className="label">Template</legend>
        <div className="space-y-1">
          {ids.map((id) => {
            const entry = TEMPLATES[id];
            const chosen = id === template;
            return (
              <label
                key={id}
                className="flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5"
                style={{
                  borderColor: chosen ? 'var(--accent)' : 'var(--border)',
                  background: chosen ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                <input type="radio" name="template" className="sr-only" checked={chosen} onChange={() => onTemplate(id)} />
                <span
                  aria-hidden="true"
                  className="mt-1 inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border"
                  style={{ borderColor: chosen ? 'var(--accent)' : 'var(--border-strong)' }}
                >
                  {chosen ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-[12.5px] font-semibold">{entry.label}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-faint">{entry.blurb}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-2.5 flex items-center gap-1.5">
        <button type="submit" className="btn btn-primary" style={{ padding: '0.3rem 0.55rem' }}>
          Create
        </button>
        <button type="button" className="btn btn-ghost" style={{ padding: '0.3rem 0.55rem' }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
