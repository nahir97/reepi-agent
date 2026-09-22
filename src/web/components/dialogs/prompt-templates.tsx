/**
 * Prompt templates: the library, and the one place a template is written.
 *
 * A template is a named set of block texts. This dialog authors them, and — because
 * a stored template is the unit the writer thinks in — it is the second of the two
 * places one can be applied. The first is the per-block menu in story settings,
 * which writes into that dialog's unsaved draft; this one saves immediately through
 * the ordinary story PATCH. There is no apply endpoint and no second write path:
 * applying is copying text.
 *
 * Three constraints shaped the markup:
 *
 * - **Templates are written with no story open.** The macro reference degrades to
 *   names and hints and applying is unavailable. Nothing here requires a bundle.
 * - **A built-in cannot be edited, only duplicated**, and the reader is told why
 *   rather than shown disabled fields with no reason.
 * - **Applying asks in place.** A confirm *dialog* would replace this one — the
 *   store holds a single dialog slot — and discard an unsaved template to answer a
 *   question about a different thing. The confirmation therefore swaps into the
 *   footer, and names the blocks it overwrites, flagging any frozen one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTokens } from '../../../shared/cost.ts';
import { DEFAULT_CALIBRATION, estimateTokens } from '../../../shared/tokens.ts';
import {
  BLOCK_LABELS,
  BLOCK_VOLATILITY,
  EDITABLE_BLOCKS,
  filledBlocks,
  templateStoryPatch,
  type EditableBlock,
  type PromptTemplate,
} from '../../../shared/types.ts';
import { useStore } from '../../store.ts';
import { IconAlert, IconPlus, IconTrash } from '../icons.tsx';
import { MacroLine, MacroPicker, insertMacro } from '../MacroPicker.tsx';
import { Shell, blockWarning } from './shell.tsx';

type Draft = { name: string; blurb: string; blocks: Partial<Record<EditableBlock, string>> };

const EMPTY_DRAFT: Draft = { name: '', blurb: '', blocks: {} };

function draftOf(template: PromptTemplate): Draft {
  return { name: template.name, blurb: template.blurb, blocks: { ...template.blocks } };
}

/** Blocks that hold text — an added-but-empty block is not one of them. */
function writtenBlocks(draft: Draft): EditableBlock[] {
  return (Object.keys(draft.blocks) as EditableBlock[]).filter(
    (block) => (draft.blocks[block] ?? '').trim().length > 0,
  );
}

export function PromptTemplatesDialog() {
  const templates = useStore((state) => state.promptTemplates);
  const macros = useStore((state) => state.macros);
  const bundle = useStore((state) => state.bundle);
  const streaming = useStore((state) => state.streaming.active);
  const saveTemplate = useStore((state) => state.saveTemplate);
  const removeTemplate = useStore((state) => state.removeTemplate);
  const applyTemplate = useStore((state) => state.applyTemplate);
  const loadMacros = useStore((state) => state.loadMacros);
  const openDialog = useStore((state) => state.openDialog);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const fields = useRef(new Map<EditableBlock, HTMLTextAreaElement | null>());
  /** The last block whose field held the caret, so `insert` knows where to land. */
  const caretIn = useRef<EditableBlock | null>(null);

  /* The reference is resolved *for the open story*, and this dialog can be the
     first surface a session opens — so it asks rather than assuming boot did. */
  useEffect(() => {
    void loadMacros();
  }, [loadMacros]);

  /* Land on the first template once the library arrives. It is fetched during
     boot, so on a cold open the list can be empty for a frame and a null id would
     leave the dialog staring at its own empty state. */
  useEffect(() => {
    if (selectedId === null && !creating && templates.length > 0) setSelectedId(templates[0]?.id ?? null);
  }, [selectedId, creating, templates]);

  /* Reset the draft on a change of selection — and only then. Keying this on the
     selected *row* would let any store write that replaces the template object (a
     save, a macro refresh) drop text mid-sentence. */
  useEffect(() => {
    if (creating) return;
    const template = templates.find((candidate) => candidate.id === selectedId) ?? null;
    if (template) setDraft(draftOf(template));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection only, by design
  }, [selectedId, creating]);

  const selected = templates.find((template) => template.id === selectedId) ?? null;
  const readOnly = selected?.builtin ?? false;
  const isNew = creating || selected === null;
  const filled = (Object.keys(draft.blocks) as EditableBlock[]);
  const written = useMemo(() => writtenBlocks(draft), [draft]);
  const dirty = !readOnly && !sameDraft(draft, creating ? null : selected);
  const canSave = dirty && draft.name.trim().length > 0 && written.length > 0;
  const appliedBlocks = selected ? filledBlocks(selected) : [];

  const setBlock = (block: EditableBlock, text: string): void => {
    setDraft((current) => ({ ...current, blocks: { ...current.blocks, [block]: text } }));
  };

  const insert = (block: EditableBlock, token: string): void => {
    const field = fields.current.get(block) ?? null;
    const current = draft.blocks[block] ?? '';
    const { value, caret } = insertMacro(field, current, token, caretIn.current === block);
    setBlock(block, value);
    /* The value is controlled, so the caret is restored after React paints the new
       text — otherwise it lands at the end of the field. */
    requestAnimationFrame(() => {
      const node = fields.current.get(block);
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  const save = async (): Promise<void> => {
    const blocks = Object.fromEntries(
      Object.entries(draft.blocks).filter(([, text]) => (text ?? '').trim().length > 0),
    );
    setBusy(true);
    const saved = await saveTemplate(selected?.id ?? null, {
      name: draft.name.trim(),
      blurb: draft.blurb,
      blocks,
    });
    setBusy(false);
    if (!saved) return;
    setCreating(false);
    setSelectedId(saved.id);
  };

  const duplicate = async (source: PromptTemplate): Promise<void> => {
    setBusy(true);
    const saved = await saveTemplate(null, {
      name: `${source.name} (copy)`,
      blurb: source.blurb,
      blocks: source.blocks,
    });
    setBusy(false);
    if (!saved) return;
    setCreating(false);
    setSelectedId(saved.id);
  };

  const startNew = (): void => {
    /* Clear the selection as well: leaving it set would keep the *previous*
       template's read-only flag, so a new template would open with locked fields
       and no way to add a block. */
    setCreating(true);
    setSelectedId(null);
    setConfirmApply(false);
    setDraft(EMPTY_DRAFT);
  };

  const choose = (id: string): void => {
    setCreating(false);
    setSelectedId(id);
    setConfirmApply(false);
  };

  return (
    <Shell
      title="Prompt templates"
      subtitle="Reusable block text for this studio. Apply one to the open story, or edit a single block by hand in Story settings."
      onClose={() => openDialog(null)}
      wide
      footer={
        confirmApply && selected ? (
          <ApplyConfirm
            template={selected}
            storyTitle={bundle?.story.title ?? ''}
            blocks={appliedBlocks}
            busy={busy}
            onCancel={() => setConfirmApply(false)}
            onConfirm={() => {
              setConfirmApply(false);
              void applyTemplate(selected);
            }}
          />
        ) : (
          <>
            {readOnly ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !selected}
                onClick={() => {
                  if (selected) void duplicate(selected);
                }}
                title="Built-in templates ship with the app: copy one and edit the copy"
              >
                Duplicate to edit
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canSave || busy}
                onClick={() => void save()}
                title={
                  draft.name.trim().length === 0
                    ? 'A template needs a name'
                    : written.length === 0
                      ? 'A template needs at least one block of text'
                      : dirty
                        ? 'Save this template to the library'
                        : 'No unsaved changes'
                }
              >
                {isNew ? 'Create template' : 'Save template'}
              </button>
            )}

            <button type="button" className="btn btn-ghost" onClick={startNew} disabled={busy} title="Start an empty template">
              <IconPlus size={11} /> New
            </button>

            {selected && !readOnly && dirty ? (
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(draftOf(selected))} disabled={busy}>
                Revert
              </button>
            ) : null}

            {selected && !readOnly ? (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: 'var(--danger)' }}
                disabled={busy}
                onClick={() => {
                  setConfirmApply(false);
                  /* Move the selection before the row disappears: leaving a stale
                     id here shows the empty state with a full list beside it. */
                  const remaining = templates.filter((candidate) => candidate.id !== selected.id);
                  setCreating(remaining.length === 0);
                  setSelectedId(remaining[0]?.id ?? null);
                  void removeTemplate(selected.id);
                }}
                title="Delete this template. Stories that used it keep the text it wrote."
              >
                <IconTrash size={11} /> Delete
              </button>
            ) : null}

            {selected && !readOnly && dirty ? <span className="text-[11px] text-faint">Unsaved edits.</span> : null}

            {selected ? (
              <button
                type="button"
                className="btn ml-auto"
                disabled={!bundle || dirty || streaming || busy || appliedBlocks.length === 0}
                onClick={() => setConfirmApply(true)}
                title={
                  !bundle
                    ? 'Open a story first'
                    : dirty
                      ? 'Save the template before applying it'
                      : streaming
                        ? 'Finish or stop the current turn first'
                        : `Overwrite ${appliedBlocks.length} block${appliedBlocks.length === 1 ? '' : 's'} in this story`
                }
              >
                Apply to story
              </button>
            ) : null}
          </>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-[15rem_minmax(0,1fr)]">
        <TemplateList templates={templates} selectedId={creating ? null : selectedId} onPick={choose} />

        <div className="min-w-0">
          {!selected && !creating ? (
            <p className="text-[12px] leading-snug text-faint">
              Pick a template on the left, or start a new one. A template holds text for one or more of the seven
              blocks you author, and the macros inside it resolve against whichever story it is applied to.
            </p>
          ) : (
            <>
              <label className="block">
                <span className="label">Name</span>
                <input
                  className="field field-sm"
                  value={draft.name}
                  readOnly={readOnly}
                  placeholder="House voice"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>

              <label className="mt-2 block">
                <span className="label">Blurb</span>
                <input
                  className="field field-sm"
                  value={draft.blurb}
                  readOnly={readOnly}
                  placeholder="One line for the list — what this is for"
                  onChange={(event) => setDraft({ ...draft, blurb: event.target.value })}
                />
              </label>

              {readOnly ? (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-faint">
                  <span className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }}>
                    <IconAlert size={11} />
                  </span>
                  <span>
                    This one ships with Reepi and is read-only by design — text under your hands should not change
                    when the app updates. Duplicate it to edit the copy.
                  </span>
                </p>
              ) : null}

              <div className="mt-3 space-y-2.5">
                {filled.map((block) => {
                  const text = draft.blocks[block] ?? '';
                  const tokens = estimateTokens(text, DEFAULT_CALIBRATION);
                  return (
                    <div key={block} className="rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className="eyebrow">{BLOCK_LABELS[block]}</span>
                        <span className="num text-[10px] text-faint">{formatTokens(tokens)} tok</span>
                        <VolatilityChip block={block} />
                        {!readOnly ? <MacroPicker macros={macros} onInsert={(token) => insert(block, token)} /> : null}
                        {!readOnly ? (
                          <button
                            type="button"
                            className="ml-auto shrink-0 text-faint hover:text-dim"
                            onClick={() =>
                              setDraft((current) => {
                                const blocks = { ...current.blocks };
                                delete blocks[block];
                                return { ...current, blocks };
                              })
                            }
                            aria-label={`Remove the ${BLOCK_LABELS[block]} block`}
                            title="Remove this block from the template"
                          >
                            <IconTrash size={11} />
                          </button>
                        ) : null}
                      </div>
                      <textarea
                        ref={(node) => {
                          fields.current.set(block, node);
                        }}
                        className="field resize-y font-serif leading-relaxed"
                        rows={block === 'contract' || block === 'story' ? 6 : 4}
                        value={text}
                        readOnly={readOnly}
                        aria-label={BLOCK_LABELS[block]}
                        onFocus={() => {
                          caretIn.current = block;
                        }}
                        onChange={(event) => setBlock(block, event.target.value)}
                      />
                      <MacroLine macros={macros} text={text} />
                      <p className="mt-1 text-[10.5px] leading-snug text-faint">{blockWarning(block, tokens)}</p>
                    </div>
                  );
                })}
              </div>

              {!readOnly ? (
                <AddBlock
                  blocks={EDITABLE_BLOCKS.filter((block) => !(block in draft.blocks))}
                  onAdd={(block) => setBlock(block, '')}
                />
              ) : null}

              {filled.length === 0 ? (
                <p className="mt-2 text-[11.5px] leading-snug text-faint">
                  Nothing to save yet — add a block and write some text in it.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

/* ----------------------------------------------------------------- pieces */

function VolatilityChip({ block }: { block: EditableBlock }) {
  const volatility = BLOCK_VOLATILITY[block];
  const color =
    volatility === 0
      ? 'var(--cache-hit)'
      : volatility === 1
        ? 'var(--accent)'
        : volatility === 2
          ? 'var(--warn)'
          : 'var(--cache-miss)';
  return (
    <span className="chip" style={{ color }}>
      volatility {volatility}
    </span>
  );
}

function AddBlock({
  blocks,
  onAdd,
}: {
  blocks: readonly EditableBlock[];
  onAdd: (block: EditableBlock) => void;
}) {
  const [choice, setChoice] = useState<EditableBlock | ''>('');
  if (blocks.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <label className="min-w-[9rem] flex-1">
        <span className="sr-only">Block to add</span>
        <select
          className="field field-sm"
          value={choice}
          onChange={(event) => setChoice(event.target.value as EditableBlock | '')}
        >
          <option value="">Add a block…</option>
          {blocks.map((block) => (
            <option key={block} value={block}>
              {BLOCK_LABELS[block]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn"
        disabled={choice === ''}
        onClick={() => {
          if (choice === '') return;
          onAdd(choice);
          setChoice('');
        }}
      >
        Add
      </button>
    </div>
  );
}

function TemplateList({
  templates,
  selectedId,
  onPick,
}: {
  templates: PromptTemplate[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  if (templates.length === 0) {
    return <p className="text-[11.5px] leading-snug text-faint">No templates yet. Start one on the right.</p>;
  }
  return (
    <ul className="max-h-[min(24rem,45vh)] space-y-1 overflow-y-auto sm:max-h-[min(30rem,60vh)]">
      {templates.map((template) => {
        const blocks = filledBlocks(template);
        const chosen = template.id === selectedId;
        return (
          <li key={template.id}>
            <button
              type="button"
              className="w-full rounded-lg border p-2 text-left"
              style={{
                borderColor: chosen ? 'var(--accent)' : 'var(--border)',
                background: chosen ? 'var(--accent-soft)' : 'transparent',
              }}
              onClick={() => onPick(template.id)}
              aria-pressed={chosen}
            >
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-display text-[12.5px] font-semibold">{template.name}</span>
                {template.builtin ? <span className="chip shrink-0">built-in</span> : null}
              </span>
              {template.blurb ? (
                <span className="mt-0.5 block text-[11px] leading-snug text-faint">{template.blurb}</span>
              ) : null}
              <span className="mt-1 block text-[10.5px] text-dim">
                {blocks.map((block) => BLOCK_LABELS[block]).join(' · ') || 'no blocks'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The apply confirmation, in the footer rather than in a dialog of its own.
 *
 * It names every block it will overwrite — a preset that fills four blocks and
 * silently replaces the story bible is not a convenience — and calls out a frozen
 * one, because that edit re-prices the entire prefix.
 */
function ApplyConfirm({
  template,
  storyTitle,
  blocks,
  busy,
  onCancel,
  onConfirm,
}: {
  template: PromptTemplate;
  storyTitle: string;
  blocks: readonly EditableBlock[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const frozen = blocks.filter((block) => BLOCK_VOLATILITY[block] === 0);
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11.5px] leading-snug">
        Overwrite <span className="font-medium">{blocks.map((block) => BLOCK_LABELS[block]).join(', ')}</span> in “
        {storyTitle}” with “{template.name}”?
      </p>
      <p className="mt-0.5 text-[10.5px] leading-snug text-faint">
        {frozen.length > 0
          ? `${frozen.map((block) => BLOCK_LABELS[block]).join(', ')} is frozen: this invalidates the whole cached prefix, and the next turn pays the miss price.`
          : 'This replaces what is in those blocks now. Everything after them goes cold until the next turn re-caches the prefix.'}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
          Overwrite {blocks.length} block{blocks.length === 1 ? '' : 's'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Structural comparison: an edit that is typed back to its original ends equal. */
function sameDraft(draft: Draft, template: PromptTemplate | null): boolean {
  if (!template) return false;
  if (draft.name !== template.name || draft.blurb !== template.blurb) return false;
  const keys = new Set([...Object.keys(draft.blocks), ...Object.keys(template.blocks)]);
  for (const key of keys) {
    const block = key as EditableBlock;
    if ((draft.blocks[block] ?? '') !== (template.blocks[block] ?? '')) return false;
  }
  return true;
}
