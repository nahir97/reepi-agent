/**
 * The inspector: everything that feeds the payload, and nothing that does not.
 *
 * The tab order is the payload order — Blocks, then Cast, Persona, Lore, Memory,
 * Scene, Director. Reading the panel top to bottom is reading the request top to
 * bottom, which is the only way the cache discipline becomes legible.
 *
 * Every edit here is explicit: the text fields hold a local draft and commit on
 * **Apply to payload**, because touching a frozen block is a decision the writer
 * should make deliberately rather than by keystroke.
 *
 * This file is the chrome only. Each tab lives in `./inspector/`, one module per
 * payload section.
 */

import { useStore, type RightTab } from '../store.ts';
import { BlocksTab } from './inspector/blocks.tsx';
import { CastTab } from './inspector/cast.tsx';
import { PersonaTab } from './inspector/persona.tsx';
import { LoreTab } from './inspector/lore.tsx';
import { MemoryTab } from './inspector/memory.tsx';
import { SceneTab } from './inspector/scene.tsx';
import { DirectorTab } from './inspector/director.tsx';

const TABS: { id: RightTab; label: string }[] = [
  { id: 'blocks', label: 'Blocks' },
  { id: 'cast', label: 'Cast' },
  { id: 'persona', label: 'Persona' },
  { id: 'lore', label: 'Lore' },
  { id: 'memory', label: 'Memory' },
  { id: 'scene', label: 'Scene' },
  { id: 'director', label: 'Director' },
];

export function Inspector() {
  const tab = useStore((state) => state.ui.rightTab);
  const setTab = useStore((state) => state.setRightTab);
  const bundle = useStore((state) => state.bundle);
  const openDialog = useStore((state) => state.openDialog);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--panel)' }}>
      <div
        className="hide-scrollbar flex shrink-0 items-center gap-4 overflow-x-auto border-b border-border px-3"
        role="tablist"
        aria-label="Inspector sections"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`panel-${entry.id}`}
            className="tab"
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.id === 'director' && bundle && bundle.notes.filter((note) => !note.accepted).length > 0 ? (
              <span className="num rounded-full px-1 text-[9px]" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
                {bundle.notes.filter((note) => !note.accepted).length}
              </span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          className="tab ml-auto shrink-0"
          onClick={() => openDialog({ kind: 'insights' })}
          title="Spend, savings, hit rate and the peak clock"
        >
          Cost
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {!bundle ? (
          <p className="text-[12px] text-faint">Open a story to inspect its payload.</p>
        ) : tab === 'blocks' ? (
          <BlocksTab />
        ) : tab === 'cast' ? (
          <CastTab />
        ) : tab === 'persona' ? (
          <PersonaTab />
        ) : tab === 'lore' ? (
          <LoreTab />
        ) : tab === 'memory' ? (
          <MemoryTab />
        ) : tab === 'scene' ? (
          <SceneTab />
        ) : (
          <DirectorTab />
        )}
      </div>
    </div>
  );
}

