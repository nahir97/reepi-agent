/**
 * Import and export: the one round-trip surface, for bundles, character cards and
 * manuscripts.
 *
 * Separate from the other dialogs because it is the only one that reads a user
 * file, and the only one whose state — format, title override, busy flag — is
 * local to a single operation rather than to the open story. Nothing else in this
 * directory shares any of it.
 */

import { useRef, useState } from 'react';
import { fileToBase64 } from '../../api.ts';
import { useStore } from '../../store.ts';
import { IconDownload, IconUpload } from '../icons.tsx';
import { Shell } from './shell.tsx';

/* ------------------------------------------------------------ import/export */

export function ImportExportDialog() {
  const openDialog = useStore((state) => state.openDialog);
  const exportStory = useStore((state) => state.exportStory);
  const importStory = useStore((state) => state.importStory);
  const bundle = useStore((state) => state.bundle);
  const toast = useStore((state) => state.toast);

  const [format, setFormat] = useState<'json' | 'chara' | 'text'>('json');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement | null>(null);

  const runImport = async (selected: File): Promise<void> => {
    setBusy(true);
    try {
      if (format === 'chara') {
        await importStory('chara', await fileToBase64(selected), title.trim() || undefined);
      } else {
        await importStory(format, await selected.text(), title.trim() || undefined);
      }
      openDialog(null);
    } catch (error) {
      toast({ kind: 'error', title: 'Could not read that file', detail: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Import and export"
      subtitle="Everything round-trips. A exported bundle re-imports with its prompts, cast, lore and memories intact."
      onClose={() => openDialog(null)}
      wide
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-lg border border-border p-3" style={{ background: 'var(--bg-sunken)' }}>
          <div className="eyebrow mb-2">
            <IconDownload size={11} /> Export
          </div>
          {bundle ? (
            <>
              <p className="mb-2.5 text-[11.5px] leading-snug text-dim">
                Exporting “{bundle.story.title}” — {bundle.messages.length} turns, {bundle.characters.length} characters,{' '}
                {bundle.lore.length} lore entries.
              </p>
              <div className="flex flex-col gap-1.5">
                <button type="button" className="btn justify-start" onClick={() => void exportStory('json')}>
                  <IconDownload size={12} />
                  Bundle (.json)
                  <span className="ml-auto text-[10.5px] text-faint">lossless, re-importable</span>
                </button>
                <button type="button" className="btn justify-start" onClick={() => void exportStory('chara')}>
                  <IconDownload size={12} />
                  Character card (.png)
                  <span className="ml-auto text-[10.5px] text-faint">SillyTavern v2</span>
                </button>
                <button type="button" className="btn justify-start" onClick={() => void exportStory('markdown')}>
                  <IconDownload size={12} />
                  Manuscript (.md)
                  <span className="ml-auto text-[10.5px] text-faint">prose only</span>
                </button>
              </div>
            </>
          ) : (
            <p className="text-[11.5px] text-faint">Open a story to export it.</p>
          )}
        </section>

        <section className="rounded-lg border border-border p-3" style={{ background: 'var(--bg-sunken)' }}>
          <div className="eyebrow mb-2">
            <IconUpload size={11} /> Import
          </div>
          <label className="label" htmlFor="import-format">
            Format
          </label>
          <select
            id="import-format"
            className="field field-sm"
            value={format}
            onChange={(event) => setFormat(event.target.value as 'json' | 'chara' | 'text')}
          >
            <option value="json">Reepi bundle (.json)</option>
            <option value="chara">Character card (.png, base64)</option>
            <option value="text">Plain prose (.txt / .md)</option>
          </select>

          <label className="label mt-2.5" htmlFor="import-title">
            Title override
          </label>
          <input
            id="import-title"
            className="field field-sm"
            value={title}
            placeholder="leave blank to use the file's own"
            onChange={(event) => setTitle(event.target.value)}
          />

          <label className="label mt-2.5" htmlFor="import-file">
            File
          </label>
          <input
            id="import-file"
            ref={file}
            className="field field-sm"
            type="file"
            accept={format === 'chara' ? 'image/png' : format === 'json' ? 'application/json,.json' : 'text/plain,text/markdown,.txt,.md'}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) void runImport(selected);
            }}
          />
          <p className="mt-2 text-[10.5px] leading-snug text-faint">
            {format === 'chara'
              ? 'A SillyTavern v2 PNG card: the character sheet is read straight out of the image metadata and becomes a character plus a story.'
              : format === 'json'
                ? 'A bundle exported from here, or any file with the same shape.'
                : 'One turn per paragraph line. Useful for pulling an old draft into the studio.'}
          </p>
          {busy ? <p className="mt-1.5 text-[11px] text-accent">Reading…</p> : null}
        </section>
      </div>
    </Shell>
  );
}
