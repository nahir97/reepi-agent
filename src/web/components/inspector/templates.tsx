/**
 * Prompt: the saved prompt text shaping this story.
 *
 * This is the answer to the friction that started the whole change. A template
 * could be written in one dialog and applied in a second, and neither of them was
 * anywhere a writer would look *while in a conversation* — the question "which
 * prompt is this chat speaking in?" had no surface at all. The blocks that hold
 * the answer were four clicks away and unlabelled once you got there.
 *
 * Two properties make this section honest rather than decorative:
 *
 * - **It reads the story, not a record.** The match count is computed from the
 *   story's own block text against the template's text, so it cannot claim a
 *   prompt the payload does not have. Edit a block by hand and the count falls;
 *   the section says so instead of insisting on a template that is no longer true.
 * - **Applying is the existing write path.** `applyTemplate` batches the
 *   template's blocks into one story PATCH — the same one the story editor saves
 *   with — so there is one meaning of "apply" and one place a write can come from.
 *
 * Applying is not free and does not pretend to be: overwriting a directive block
 * re-prices the payload from there to the end, and a volatility-0 block re-prices
 * the whole prefix. The confirmation names every block it will overwrite and calls
 * out the frozen ones, because a convenience that silently doubles tomorrow's bill
 * is not a convenience.
 */

import { useState } from 'react';
import {
  BLOCK_LABELS,
  BLOCK_VOLATILITY,
  EDITABLE_BLOCK_FIELD,
  filledBlocks,
  type PromptTemplate,
} from '../../../shared/types.ts';
import { useStore } from '../../store.ts';
import { IconCheck, IconPen, IconPlus } from '../icons.tsx';

export function TemplatesTab() {
  const templates = useStore((state) => state.promptTemplates);
  const applied = useStore((state) => state.ui.appliedTemplate);
  const appliedId = applied?.templateId ?? null;

  if (templates.length === 0) {
    return (
      <div>
        <p className="text-[12px] leading-snug text-faint">
          No templates yet. A template is named text for one or more of the seven blocks you author, with macros that
          stay unresolved so it keeps resolving against whichever story it is applied to.
        </p>
        <NewTemplateButton />
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-[11px] leading-snug text-faint">
        Applying a template copies its text into this story's blocks. It is not remembered as an owner: the story keeps
        the words, and a template you edit afterwards is simply a different set of words.
      </p>

      <ul className="space-y-2">
        {templates.map((template) => (
          <li key={template.id}>
            <TemplateCard template={template} applied={template.id === appliedId} />
          </li>
        ))}
      </ul>

      <NewTemplateButton />
    </div>
  );
}

/* ----------------------------------------------------------------- one row */

function TemplateCard({ template, applied }: { template: PromptTemplate; applied: boolean }) {
  const bundle = useStore((state) => state.bundle);
  const appliedRecord = useStore((state) => state.ui.appliedTemplate);
  const applyTemplate = useStore((state) => state.applyTemplate);
  const openDialog = useStore((state) => state.openDialog);
  const streaming = useStore((state) => state.streaming.active);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const blocks = filledBlocks(template);
  const matching = bundle ? countMatching(template, bundle.story) : 0;
  const frozen = blocks.filter((block) => BLOCK_VOLATILITY[block] === 0);
  /** Only the applied template reports a match count; the rest are candidates. */
  const isApplied = applied && appliedRecord !== null;

  return (
    <div className="card p-2.5" style={{ background: 'var(--panel-raised)' }}>
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate font-display text-[13px] font-semibold">{template.name}</span>
            {template.builtin ? <span className="chip shrink-0">built-in</span> : null}
            {isApplied ? (
              <span className="chip chip-hit shrink-0">
                <IconCheck size={9} />
                {matching === blocks.length ? 'applied' : `applied · ${matching}/${blocks.length} match`}
              </span>
            ) : null}
          </span>
          {template.blurb ? (
            <span className="mt-0.5 block text-[11px] leading-snug text-faint">{template.blurb}</span>
          ) : null}
        </span>
      </div>

      {/* What it would write, block by block, with the frozen ones marked — the
          same volatility table the story editor warns with, so the two surfaces
          cannot disagree about what an edit here costs. */}
      <ul className="mt-2 flex flex-wrap items-center gap-1">
        {blocks.map((block) => (
          <li
            key={block}
            className="chip"
            style={
              BLOCK_VOLATILITY[block] === 0
                ? { color: 'var(--cache-hit)' }
                : BLOCK_VOLATILITY[block] === 1
                  ? { color: 'var(--accent)' }
                  : BLOCK_VOLATILITY[block] === 2
                    ? { color: 'var(--warn)' }
                    : undefined
            }
            title={`volatility ${BLOCK_VOLATILITY[block]}`}
          >
            {BLOCK_LABELS[block]}
          </li>
        ))}
      </ul>

      {confirming ? (
        <div className="mt-2.5 rounded-md border border-border p-2" style={{ background: 'var(--bg-sunken)' }}>
          <p className="text-[11.5px] leading-snug">
            Overwrite{' '}
            <span className="font-medium">{blocks.map((block) => BLOCK_LABELS[block]).join(', ')}</span> in “
            {bundle?.story.title ?? 'this story'}”?
          </p>
          <p className="mt-0.5 text-[10.5px] leading-snug text-faint">
            {frozen.length > 0
              ? `${frozen.map((block) => BLOCK_LABELS[block]).join(', ')} ${
                  frozen.length === 1 ? 'is' : 'are'
                } frozen: this invalidates the whole cached prefix, and the next turns pay the miss price.`
              : 'This replaces what is in those blocks now. Everything after them goes cold until the next turn re-caches the prefix.'}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '0.25rem 0.5rem' }}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setConfirming(false);
                void applyTemplate(template).finally(() => setBusy(false));
              }}
            >
              Overwrite {blocks.length} block{blocks.length === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0.25rem 0.5rem' }}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="btn"
            style={{ padding: '0.25rem 0.5rem' }}
            disabled={!bundle || streaming || busy || blocks.length === 0}
            onClick={() => setConfirming(true)}
            title={
              !bundle
                ? 'Open a story first'
                : streaming
                  ? 'Finish or stop the current turn first'
                  : `Overwrite ${blocks.length} block${blocks.length === 1 ? '' : 's'} in this story`
            }
          >
            {isApplied ? 'Apply again' : 'Apply to story'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.25rem 0.5rem' }}
            onClick={() => openDialog({ kind: 'prompt-templates' })}
            title={template.builtin ? 'Built-ins are read-only — duplicate to edit' : 'Edit this template'}
          >
            <IconPen size={11} />
            {template.builtin ? 'Duplicate' : 'Edit'}
          </button>
        </div>
      )}

      {isApplied && matching < blocks.length ? (
        <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
          {matching === 0
            ? 'None of its blocks still match — this story’s text has moved on since it was applied.'
            : `${blocks.length - matching} of its blocks have been edited since it was applied.`}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

/** How many of a template's non-empty blocks the story's own text still equals. */
function countMatching(template: PromptTemplate, story: { [key: string]: unknown }): number {
  return filledBlocks(template).filter((block) => {
    const field = EDITABLE_BLOCK_FIELD[block];
    return (template.blocks[block] ?? '') === String(story[field] ?? '');
  }).length;
}

/** The way to the library from a section that is otherwise a dead end. */
function NewTemplateButton() {
  const openDialog = useStore((state) => state.openDialog);
  return (
    <button
      type="button"
      className="btn btn-ghost mt-3 w-full justify-start"
      style={{ padding: '0.3rem 0.45rem' }}
      onClick={() => openDialog({ kind: 'prompt-templates' })}
    >
      <IconPlus size={12} />
      Open the template library
    </button>
  );
}
