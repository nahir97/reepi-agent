/**
 * Which prompt this conversation speaks in, and the one action that changes it.
 *
 * The story panel and the composer's overrides popover both render this. It exists
 * as one component because the two hosts answer the same question — "what template
 * is this chat using, and how do I pick another" — and two implementations of that
 * would disagree within a week about what "applied" means.
 *
 * What it reads is `story.templateId`, which is a real column now: a conversation
 * *owns* the fact that it was applied from a template. What it does not read is the
 * block text — applying still copies, and the story still keeps the words if the
 * template is later deleted or edited. The match count is derived from both, so the
 * component can say the true thing in every state:
 *
 * - no link → **Hand-written**, and the picker is offered.
 * - a link whose blocks all still match → *applied*.
 * - a link whose blocks have been edited since → *N of M match*, which is what a
 *   writer needs to know before pressing Apply and flattening their own edits.
 * - a link to a template that no longer exists (deleted elsewhere, or a built-in
 *   that a later release dropped) → treated as none, because a link that cannot
 *   resolve is not a fact about this conversation.
 */

import { filledBlocks, templateMatch, BLOCK_LABELS } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { IconCheck, IconPen, IconTemplate } from './icons.tsx';

export function PromptPicker({ compact = false }: { compact?: boolean }) {
  const bundle = useStore((state) => state.bundle);
  const templates = useStore((state) => state.promptTemplates);
  const streaming = useStore((state) => state.streaming.active);
  const updateStory = useStore((state) => state.updateStory);
  const applyTemplate = useStore((state) => state.applyTemplate);
  const openDialog = useStore((state) => state.openDialog);

  if (!bundle) return null;
  const story = bundle.story;
  const current = story.templateId ? (templates.find((template) => template.id === story.templateId) ?? null) : null;
  const match = templateMatch(current, story);
  const stale = story.templateId !== null && current === null;

  const switchTo = async (id: string): Promise<void> => {
    if (id === '') {
      /* Forget the link. The blocks stay exactly as they are — that is the point of
         a link rather than a copy. */
      await updateStory({ templateId: null });
      return;
    }
    const template = templates.find((candidate) => candidate.id === id);
    if (template) await applyTemplate(template);
  };

  return (
    <div className={compact ? '' : 'rounded-lg border border-border p-2.5'} style={compact ? undefined : { background: 'var(--bg-sunken)' }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="eyebrow shrink-0">Prompt</span>
        {current && match ? (
          <span className="chip chip-hit shrink-0" title={`Applied from “${current.name}”`}>
            <IconCheck size={9} />
            {match.matching === match.filled
              ? `${current.name} · applied`
              : `${current.name} · ${match.matching}/${match.filled} match`}
          </span>
        ) : (
          <span className="chip shrink-0" title={stale ? 'The template this story used no longer exists' : undefined}>
            {stale ? 'template gone' : 'hand-written'}
          </span>
        )}
        {current ? (
          <button
            type="button"
            className="btn btn-ghost shrink-0"
            style={{ padding: '0.2rem 0.45rem' }}
            onClick={() => openDialog({ kind: 'prompt-templates', templateId: current.id })}
            title={current.builtin ? 'Built-ins are read-only — duplicate to edit' : 'Edit this template'}
          >
            <IconPen size={10} />
            {current.builtin ? 'Duplicate' : 'Edit'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost shrink-0"
            style={{ padding: '0.2rem 0.45rem' }}
            onClick={() => openDialog({ kind: 'prompt-templates' })}
          >
            <IconTemplate size={10} />
            Library
          </button>
        )}
      </div>

      <label className="mt-2 block">
        <span className="sr-only">The prompt template this conversation speaks in</span>
        <select
          className="field field-sm"
          value={current?.id ?? ''}
          disabled={streaming || templates.length === 0}
          title={
            streaming
              ? 'Finish or stop the current turn first'
              : templates.length === 0
                ? 'No templates yet — write one in the prompt library'
                : 'Picking one copies its text into this conversation, replacing the blocks it fills'
          }
          onChange={(event) => void switchTo(event.target.value)}
        >
          <option value="">Hand-written — no template</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
              {template.builtin ? ' (built-in)' : ''} — {filledBlocks(template).map((block) => BLOCK_LABELS[block]).join(', ')}
            </option>
          ))}
        </select>
      </label>

      {!compact ? (
        <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
          {stale
            ? 'The template this conversation was applied from has been deleted. Its words are still in the story, so nothing was lost — pick another, or write one.'
            : current
              ? match && match.matching < match.filled
                ? `You have edited ${match.filled - match.matching} of this template's ${match.filled} block${
                    match.filled === 1 ? '' : 's'
                  } since it was applied. Picking it again replaces the text; editing the template leaves this story alone.`
                : 'Picking another copies its text over the blocks it fills, at the front of the payload — the next turn pays one miss and every turn after it hits.'
              : 'A template is named text for the blocks this conversation sends first. Copying one in does not tie the story to it: the words become the story’s own.'}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One line for a host that only wants to *report* the prompt, not change it.
 *
 * The story panel's row shows this and makes the whole row the way in, because a
 * panel you keep open while reading should not grow a second select control.
 */
export function usePromptSummary(): string {
  const bundle = useStore((state) => state.bundle);
  const templates = useStore((state) => state.promptTemplates);

  if (!bundle) return '';
  const story = bundle.story;
  if (!story.templateId) return 'hand-written';
  const template = templates.find((candidate) => candidate.id === story.templateId) ?? null;
  if (!template) return 'the template was deleted · hand-written now';
  const match = templateMatch(template, story);
  if (!match) return template.name;
  return match.matching === match.filled
    ? `${template.name} · applied`
    : `${template.name} · ${match.matching}/${match.filled} match`;
}
