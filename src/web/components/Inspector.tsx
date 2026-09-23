/**
 * The inspector: everything that feeds the payload, and nothing that does not.
 *
 * It is a **drill-down, not a tab strip**. The front page is `InspectMenu` — one
 * row per section, each carrying its own live summary — and choosing a row opens
 * that section with a back control in place of the title. The band above is
 * always exactly one band: *Inspect* with a close on the menu, the section's name
 * and summary with a back once one is open.
 *
 * Two reasons the rail works this way and the phone's sheet reaches the same
 * sections as flat rows: the rail is 21rem and permanently on screen, so a
 * seven-tab strip there was a wall of abbreviations in the narrowest column in
 * the app; and a menu row has room to say what the section currently contains,
 * which a tab cannot. The sheet lists the payload sections only, and reaches the
 * cast through the studio list's `Cast` page rather than through rows named for
 * the people it holds. The section order here is payload order — Blocks, then
 * Cast, Persona, Lore, Memory, Scene, Director — so reading the menu top to
 * bottom is reading the request top to bottom, which is the only way the cache
 * discipline becomes legible.
 *
 * This file is the chrome only. Each section lives in one module under
 * `./inspector/`.
 */

import { useStore } from '../store.ts';
import { BlocksTab } from './inspector/blocks.tsx';
import { CastTab } from './inspector/cast.tsx';
import { InspectMenu, SECTION_LABEL, useSectionSummary } from './inspector/menu.tsx';
import { PersonaTab } from './inspector/persona.tsx';
import { LoreTab } from './inspector/lore.tsx';
import { MemoryTab } from './inspector/memory.tsx';
import { SceneTab } from './inspector/scene.tsx';
import { TemplatesTab } from './inspector/templates.tsx';
import { DirectorTab } from './inspector/director.tsx';
import { IconChevronRight, IconClose } from './icons.tsx';

export function Inspector({ onClose }: { onClose?: () => void }) {
  const view = useStore((state) => state.ui.rightTab);
  const setView = useStore((state) => state.setRightTab);
  const bundle = useStore((state) => state.bundle);
  const open = view !== null;

  /* One band, in both states — so opening a section replaces the title rather
     than stacking a second bar under it. */
  const band = (
    <div className="topbar pt-safe shrink-0 gap-1.5 border-b border-border px-2">
      {open ? (
        <button
          type="button"
          className="icon-btn shrink-0"
          style={{ width: 26, height: 26 }}
          onClick={() => setView(null)}
          aria-label="Back to the section menu"
        >
          <span className="inline-block rotate-180">
            <IconChevronRight size={13} />
          </span>
        </button>
      ) : null}
      <SectionTitleInline />
      {onClose ? (
        <button type="button" className="icon-btn ml-auto shrink-0" onClick={onClose} aria-label="Hide the payload inspector">
          <IconClose size={13} />
        </button>
      ) : null}
    </div>
  );

  if (!bundle) {
    return (
      <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--panel)' }}>
        {band}
        <p className="p-3 text-[12px] text-faint">Open a story to inspect its payload.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--panel)' }}>
      {band}
      {open ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {view === 'blocks' ? (
            <BlocksTab />
          ) : view === 'templates' ? (
            <TemplatesTab />
          ) : view === 'cast' ? (
            <CastTab />
          ) : view === 'persona' ? (
            <PersonaTab />
          ) : view === 'lore' ? (
            <LoreTab />
          ) : view === 'memory' ? (
            <MemoryTab />
          ) : view === 'scene' ? (
            <SceneTab />
          ) : (
            <DirectorTab />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <InspectMenu />
        </div>
      )}
    </div>
  );
}

/**
 * The band's text: the section's name and its live summary when one is open,
 * `Inspect` when not. `InspectMenu` owns the summary strings so a section's
 * heading and its menu row can never disagree.
 */
function SectionTitleInline() {
  const view = useStore((state) => state.ui.rightTab);
  const summary = useSectionSummary(view);
  return (
    <span className="min-w-0 flex-1">
      <span className="eyebrow block truncate">{view === null ? 'Inspect' : SECTION_LABEL[view]}</span>
      <span className="num block truncate text-[10px] text-faint">{summary}</span>
    </span>
  );
}
