/**
 * Story settings: every prompt block, with its live token count and volatility.
 *
 * This is the important dialog. It warns, specifically, about whatever editing a
 * block would invalidate, which is the product's whole argument stated where the
 * decision is actually being made. It owns the block-to-field map and the story
 * draft, so a change to the block schema and the code that reads it are one edit.
 */

import { useEffect, useRef, useState } from 'react';
import { formatTokens } from '../../../shared/cost.ts';
import {
  BLOCK_LABELS,
  BLOCK_VOLATILITY,
  EDITABLE_BLOCKS,
  EDITABLE_BLOCK_FIELD,
  EFFORT_LABELS,
  filledBlocks,
  MODELS,
  templateStoryPatch,
} from '../../../shared/types.ts';
import type { EditableBlock, ModelId, PromptTemplate, ReasoningEffort, Story } from '../../../shared/types.ts';
import { DEFAULT_CALIBRATION, estimateTokens } from '../../../shared/tokens.ts';
import { useStore } from '../../store.ts';
import { IconAlert, IconChevronDown } from '../icons.tsx';
import { MacroLine, MacroPicker, insertMacro } from '../MacroPicker.tsx';
import { Shell, blockWarning } from './shell.tsx';

/* ------------------------------------------------------------- story settings */

export function StorySettingsDialog() {
  const bundle = useStore((state) => state.bundle);
  const updateStory = useStore((state) => state.updateStory);
  const openDialog = useStore((state) => state.openDialog);
  const setTheme = useStore((state) => state.setTheme);
  const streaming = useStore((state) => state.streaming.active);
  const macros = useStore((state) => state.macros);
  const templates = useStore((state) => state.promptTemplates);

  const story = bundle?.story ?? null;
  const [draft, setDraft] = useState<Story | null>(story);
  const fields = useRef(new Map<EditableBlock, HTMLTextAreaElement | null>());
  /** The last block whose field held the caret, so inserting a macro lands there. */
  const caretIn = useRef<EditableBlock | null>(null);

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

  const changedBlocks = EDITABLE_BLOCKS.filter(
    (kind) => draft[EDITABLE_BLOCK_FIELD[kind]] !== story[EDITABLE_BLOCK_FIELD[kind]],
  );

  /** Write one template's text for one block into the draft. Saving still decides. */
  const applyTemplate = (block: EditableBlock, template: PromptTemplate): void => {
    const patch = templateStoryPatch(template.blocks, [block]);
    for (const [field, text] of Object.entries(patch)) {
      if (text !== undefined) setField(field as keyof Story, text);
    }
  };

  const insert = (block: EditableBlock, token: string): void => {
    const field = EDITABLE_BLOCK_FIELD[block];
    const current = String(draft[field] ?? '');
    const { value, caret } = insertMacro(fields.current.get(block) ?? null, current, token, caretIn.current === block);
    setField(field, value);
    requestAnimationFrame(() => {
      const node = fields.current.get(block);
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  return (
    <Shell
      title="Story settings"
      subtitle="Every block below is a real slice of the request, in payload order. Reusable text lives in Prompt templates, from the studio menu."
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
        {EDITABLE_BLOCKS.map((kind) => {
          const field = EDITABLE_BLOCK_FIELD[kind];
          const value = String(draft[field] ?? '');
          const tokens = estimateTokens(value, DEFAULT_CALIBRATION);
          const volatility = BLOCK_VOLATILITY[kind];
          const changed = value !== String(story[field] ?? '');
          return (
            <div key={kind} className="rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
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
                {/* Both controls sit on the block they act on, and both write into
                    the draft: nothing reaches the database until Save. */}
                <TemplateApplyMenu templates={templates} block={kind} onApply={(template) => applyTemplate(kind, template)} />
                <MacroPicker macros={macros} onInsert={(token) => insert(kind, token)} />
              </div>
              <label className="sr-only" htmlFor={`block-${kind}`}>
                {BLOCK_LABELS[kind]}
              </label>
              <textarea
                id={`block-${kind}`}
                ref={(node) => {
                  fields.current.set(kind, node);
                }}
                className="field resize-y font-serif leading-relaxed"
                rows={kind === 'contract' || kind === 'story' ? 6 : 3}
                value={value}
                onFocus={() => {
                  caretIn.current = kind;
                }}
                onChange={(event) => setField(field, event.target.value as Story[typeof field])}
              />
              <MacroLine macros={macros} text={value} />
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

/* ------------------------------------------------------------ apply a template */

/**
 * The per-block template menu.
 *
 * Templates that were written *for* this block come first, because that is the
 * common case; the rest follow under a divider, since a template is just text and
 * refusing to insert it here would be a rule with no cost model behind it. The
 * target is a filing hint, not a lock — but the order says which one it is.
 *
 * Applying **replaces** the block's text in the draft. Nothing is written until
 * Save, so the destructive part is one Cancel away, and the dialog's own pending
 * banner then names the blocks that changed.
 */
function TemplateApplyMenu({
  templates,
  block,
  onApply,
}: {
  templates: PromptTemplate[];
  block: EditableBlock;
  onApply: (template: PromptTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const forBlock = templates.filter((template) => (template.blocks[block] ?? '').trim().length > 0);
  const others = templates.filter((candidate) => !forBlock.includes(candidate));

  return (
    <div className="min-w-0">
      <button
        type="button"
        className="chip flex items-center gap-1"
        style={{ borderColor: 'var(--border)' }}
        onClick={() => setOpen((value) => !value)}
        disabled={templates.length === 0}
        aria-expanded={open}
        title={
          templates.length === 0
            ? 'No templates yet — write one from Prompt templates in the studio menu'
            : 'Replace this block with a saved template'
        }
      >
        <span className="text-dim">Templates</span>
        <span className="text-faint">
          <IconChevronDown size={9} />
        </span>
      </button>

      {open ? (
        <div className="mt-1.5 rounded-lg border border-border p-2" style={{ background: 'var(--bg)' }}>
          <p className="mb-1.5 text-[10.5px] leading-snug text-faint">
            Replaces what is in this block now. Unsaved until you press Save.
          </p>
          {templates.length === 0 ? (
            <p className="text-[11.5px] leading-snug text-dim">
              No templates yet. Studio → Prompt templates writes them, and a new one can be duplicated from the
              built-in set.
            </p>
          ) : (
            <ul className="max-h-[min(18rem,40vh)] space-y-0.5 overflow-y-auto">
              {forBlock.map((template) => (
                <TemplateRow
                  key={template.id}
                  template={template}
                  chosen
                  onPick={() => {
                    setOpen(false);
                    onApply(template);
                  }}
                />
              ))}
              {forBlock.length > 0 && others.length > 0 ? (
                <li className="eyebrow px-1.5 pt-1.5">Written for other blocks</li>
              ) : null}
              {others.map((template) => (
                <TemplateRow
                  key={template.id}
                  template={template}
                  chosen={false}
                  onPick={() => {
                    setOpen(false);
                    onApply(template);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TemplateRow({
  template,
  chosen,
  onPick,
}: {
  template: PromptTemplate;
  chosen: boolean;
  onPick: () => void;
}) {
  const blocks = filledBlocks(template);
  return (
    <li>
      <button
        type="button"
        className="w-full rounded-md px-1.5 py-1 text-left row-hover"
        onClick={onPick}
        title={template.blurb || template.name}
      >
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[11.5px]">{template.name}</span>
          {chosen ? <span className="chip shrink-0">for this block</span> : null}
        </span>
        <span className="mt-0.5 block truncate text-[10.5px] text-faint">
          {blocks.map((kind) => BLOCK_LABELS[kind]).join(' · ')}
        </span>
      </button>
    </li>
  );
}
