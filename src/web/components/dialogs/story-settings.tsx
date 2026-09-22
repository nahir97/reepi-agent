/**
 * Story settings: every prompt block, with its live token count and volatility.
 *
 * This is the important dialog. It warns, specifically, about whatever editing a
 * block would invalidate, which is the product's whole argument stated where the
 * decision is actually being made. It owns the block-to-field map and the story
 * draft, so a change to the block schema and the code that reads it are one edit.
 */

import { useEffect, useState } from 'react';
import { formatTokens } from '../../../shared/cost.ts';
import { BLOCK_LABELS, BLOCK_VOLATILITY, EFFORT_LABELS, MODELS } from '../../../shared/types.ts';
import type { BlockKind, ModelId, ReasoningEffort, Story } from '../../../shared/types.ts';
import { DEFAULT_CALIBRATION, estimateTokens } from '../../../shared/tokens.ts';
import { useStore } from '../../store.ts';
import { IconAlert } from '../icons.tsx';
import { Shell, blockWarning } from './shell.tsx';

/* ------------------------------------------------------------- story settings */

/** Where a block's text lives on the `Story` row, when it is editable at all. */
const BLOCK_FIELD: Partial<Record<BlockKind, keyof Story>> = {
  contract: 'contract',
  genre: 'genre',
  style: 'style',
  story: 'bible',
  scenario: 'scenario',
  exemplars: 'exemplars',
  instruct: 'instruct',
};

const STORY_BLOCKS: BlockKind[] = ['contract', 'genre', 'style', 'story', 'scenario', 'exemplars', 'instruct'];

export function StorySettingsDialog() {
  const bundle = useStore((state) => state.bundle);
  const updateStory = useStore((state) => state.updateStory);
  const openDialog = useStore((state) => state.openDialog);
  const setTheme = useStore((state) => state.setTheme);
  const streaming = useStore((state) => state.streaming.active);

  const story = bundle?.story ?? null;
  const [draft, setDraft] = useState<Story | null>(story);

  useEffect(() => {
    setDraft(story);
  }, [story?.id]);

  if (!story || !draft) {
    return (
      <Shell title="Story settings" onClose={() => openDialog(null)}>
        <p className="text-[12px] text-faint">Open a story first.</p>
      </Shell>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(story);

  const setField = <K extends keyof Story>(key: K, value: Story[K]): void => {
    setDraft({ ...draft, [key]: value });
  };

  const save = async (): Promise<void> => {
    const patch: Partial<Story> = {};
    for (const key of Object.keys(draft) as (keyof Story)[]) {
      if (draft[key] !== story[key]) (patch as Record<string, unknown>)[key] = draft[key];
    }
    if (Object.keys(patch).length === 0) {
      openDialog(null);
      return;
    }
    await updateStory(patch);
    openDialog(null);
  };

  const changedBlocks = STORY_BLOCKS.filter((kind) => {
    const field = BLOCK_FIELD[kind];
    return field !== undefined && draft[field] !== story[field];
  });

  return (
    <Shell
      title="Story settings"
      subtitle="Every block below is a real slice of the request, in payload order."
      onClose={() => openDialog(null)}
      wide
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!dirty || streaming}>
            Save {changedBlocks.length > 0 ? `${changedBlocks.length} block${changedBlocks.length === 1 ? '' : 's'}` : 'changes'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => openDialog(null)}>
            Cancel
          </button>
          {dirty ? (
            <span className="text-[11px] text-faint">
              {streaming ? 'Finish or stop the current turn first.' : 'Saving re-measures the payload immediately.'}
            </span>
          ) : (
            <span className="text-[11px] text-faint">No unsaved changes.</span>
          )}
        </>
      }
    >
      {changedBlocks.length > 0 ? (
        <div
          className="mb-3 flex items-start gap-2 rounded-lg border p-2.5"
          style={{ borderColor: 'color-mix(in oklab, var(--warn) 45%, var(--border))', background: 'color-mix(in oklab, var(--warn) 8%, transparent)' }}
        >
          <span className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }}>
            <IconAlert size={13} />
          </span>
          <div className="text-[11.5px] leading-snug">
            <p className="font-medium">
              {changedBlocks.length} block{changedBlocks.length === 1 ? '' : 's'} pending:{' '}
              {changedBlocks.map((kind) => BLOCK_LABELS[kind]).join(', ')}
            </p>
            <p className="mt-0.5 text-dim">
              {changedBlocks.some((kind) => BLOCK_VOLATILITY[kind] === 0)
                ? 'One of them is frozen. Saving will invalidate the entire cached prefix and your next several turns will pay the miss price — fifty times a hit. Warm the cache after saving.'
                : 'Saving changes the payload at these positions. Blocks after them go cold until the next turn re-caches the prefix.'}
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {STORY_BLOCKS.map((kind) => {
          const field = BLOCK_FIELD[kind];
          if (field === undefined) return null;
          const value = String(draft[field] ?? '');
          const tokens = estimateTokens(value, DEFAULT_CALIBRATION);
          const volatility = BLOCK_VOLATILITY[kind];
          const changed = value !== String(story[field] ?? '');
          return (
            <div key={kind} className="rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
              <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                <span className="eyebrow">{BLOCK_LABELS[kind]}</span>
                <span className="num text-[10px] text-faint">{formatTokens(tokens)} tok</span>
                <span
                  className="chip"
                  style={{
                    color:
                      volatility === 0
                        ? 'var(--cache-hit)'
                        : volatility === 1
                          ? 'var(--accent)'
                          : volatility === 2
                            ? 'var(--warn)'
                            : 'var(--cache-miss)',
                  }}
                >
                  volatility {volatility}
                </span>
                {changed ? <span className="chip chip-miss">pending edit</span> : null}
              </div>
              <label className="sr-only" htmlFor={`block-${kind}`}>
                {BLOCK_LABELS[kind]}
              </label>
              <textarea
                id={`block-${kind}`}
                className="field resize-y font-serif leading-relaxed"
                rows={kind === 'contract' || kind === 'story' ? 6 : 3}
                value={value}
                onChange={(event) => setField(field, event.target.value as Story[typeof field])}
              />
              <p className="mt-1 text-[10.5px] leading-snug text-faint">{blockWarning(kind, tokens)}</p>
            </div>
          );
        })}

        {/* ----------------------------------------------------- knobs */}

        <div className="rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
          <div className="eyebrow mb-2">Generation</div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="set-model">
                Model
              </label>
              <select
                id="set-model"
                className="field field-sm"
                value={draft.model}
                onChange={(event) => setField('model', event.target.value as ModelId)}
              >
                {(Object.keys(MODELS) as ModelId[]).map((model) => (
                  <option key={model} value={model}>
                    {MODELS[model].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="set-effort">
                Effort
              </label>
              <select
                id="set-effort"
                className="field field-sm"
                value={draft.effort}
                onChange={(event) => setField('effort', event.target.value as ReasoningEffort)}
              >
                {(Object.keys(EFFORT_LABELS) as ReasoningEffort[]).map((effort) => (
                  <option key={effort} value={effort}>
                    {EFFORT_LABELS[effort]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="set-words">
                Target words
              </label>
              <input
                id="set-words"
                className="field field-sm num"
                type="number"
                value={draft.targetWords}
                onChange={(event) => setField('targetWords', Number(event.target.value) || 0)}
              />
            </div>
            <div>
              <label className="label" htmlFor="set-temp">
                Temperature
              </label>
              <input
                id="set-temp"
                className="field field-sm num"
                type="number"
                step={0.05}
                value={draft.temperature}
                onChange={(event) => setField('temperature', Number(event.target.value))}
              />
            </div>
            <div>
              <label className="label" htmlFor="set-topp">
                Top P
              </label>
              <input
                id="set-topp"
                className="field field-sm num"
                type="number"
                step={0.01}
                value={draft.topP}
                onChange={(event) => setField('topP', Number(event.target.value))}
              />
            </div>
            <div>
              <label className="label" htmlFor="set-max">
                Max output tokens
              </label>
              <input
                id="set-max"
                className="field field-sm num"
                type="number"
                value={draft.maxTokens}
                onChange={(event) => setField('maxTokens', Number(event.target.value) || 0)}
              />
            </div>
            <div>
              <label className="label" htmlFor="set-lore">
                Lore budget (tokens)
              </label>
              <input
                id="set-lore"
                className="field field-sm num"
                type="number"
                value={draft.loreBudget}
                onChange={(event) => setField('loreBudget', Number(event.target.value) || 0)}
              />
            </div>
            <div>
              <label className="label" htmlFor="set-history">
                Transcript budget (tokens)
              </label>
              <input
                id="set-history"
                className="field field-sm num"
                type="number"
                value={draft.historyBudget}
                onChange={(event) => setField('historyBudget', Number(event.target.value) || 0)}
              />
            </div>
            <div>
              <label className="label" htmlFor="set-prefill">
                Prefill
              </label>
              <input
                id="set-prefill"
                className="field field-sm"
                value={draft.prefill}
                placeholder="none"
                onChange={(event) => setField('prefill', event.target.value)}
              />
            </div>
          </div>
          <p className="mt-2 text-[10.5px] leading-snug text-faint">
            Prefill rides as a prefix completion. The provider caches it like any other prefix token, so a stable
            prefill is nearly free; changing it every turn makes the tail uncacheable.
          </p>
        </div>

        {/* ----------------------------------------------------- identity */}

        <div className="rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
          <div className="eyebrow mb-2">Identity</div>
          <label className="label" htmlFor="set-title">
            Title
          </label>
          <input id="set-title" className="field field-sm" value={draft.title} onChange={(event) => setField('title', event.target.value)} />
          <label className="label mt-2.5" htmlFor="set-theme">
            Theme
          </label>
          <select
            id="set-theme"
            className="field field-sm"
            value={draft.theme}
            onChange={(event) => {
              const theme = event.target.value as Story['theme'];
              setField('theme', theme);
              setTheme(theme);
            }}
          >
            {(['ink', 'ember', 'verdant', 'daylight'] as const).map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Shell>
  );
}
