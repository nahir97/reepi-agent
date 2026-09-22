/**
 * The template chooser, for when the empty state is not what you came through.
 * The blurbs are the server's own `TEMPLATES` copy, so the thing described here
 * is exactly the thing the composer will build a prefix from.
 *
 * It is its own module because it is the only dialog that runs before a story
 * exists: everything it needs is the template list, never the open bundle.
 */

import { useState } from 'react';
import { TEMPLATES, type StoryTemplateId } from '../../../shared/api.ts';
import { useStore } from '../../store.ts';
import { Shell } from './shell.tsx';

/* ------------------------------------------------------------ new story */

export function NewStoryDialog() {
  const openDialog = useStore((state) => state.openDialog);
  const createStory = useStore((state) => state.createStory);
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<StoryTemplateId>('hollow-court');
  const [busy, setBusy] = useState(false);

  const ids = Object.keys(TEMPLATES) as StoryTemplateId[];

  const submit = async (): Promise<void> => {
    setBusy(true);
    const created = await createStory(title.trim() || TEMPLATES[template].label, template);
    setBusy(false);
    if (created) openDialog(null);
  };

  return (
    <Shell
      title="New story"
      subtitle="Every template pre-fills the frozen blocks — those are the ones you want to stop editing early."
      onClose={() => openDialog(null)}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            Create story
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => openDialog(null)}>
            Cancel
          </button>
        </>
      }
    >
      <label className="label" htmlFor="ns-title">
        Title
      </label>
      <input
        id="ns-title"
        className="field"
        autoFocus
        value={title}
        placeholder="Leave blank to use the template's own title"
        onChange={(event) => setTitle(event.target.value)}
      />

      <fieldset className="mt-3.5">
        <legend className="label">Template</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {ids.map((id) => {
            const entry = TEMPLATES[id];
            const chosen = id === template;
            return (
              <label
                key={id}
                className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5"
                style={{
                  borderColor: chosen ? 'var(--accent)' : 'var(--border)',
                  background: chosen ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="ns-template"
                  className="sr-only"
                  checked={chosen}
                  onChange={() => setTemplate(id)}
                />
                <span
                  aria-hidden="true"
                  className="mt-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border"
                  style={{ borderColor: chosen ? 'var(--accent)' : 'var(--border-strong)' }}
                >
                  {chosen ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-[13px] font-semibold">{entry.label}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">{entry.blurb}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </Shell>
  );
}
