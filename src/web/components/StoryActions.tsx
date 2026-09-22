/**
 * A row's actions, behind one control.
 *
 * These used to be three separate buttons that appeared together on hover. That
 * is a cluster of destructive controls a writer has to aim at, and on a phone
 * none of them existed at all. One disclosure keeps the row's own click target
 * large and gives every action the room to say its name.
 *
 * The menu is anchored to the viewport (`position: fixed`) rather than to the
 * row. Its two hosts — the library rail and the phone's navigation sheet — are
 * both `overflow-y-auto` scrollers, and an absolutely positioned popover is
 * clipped by its scroller no matter which way it opens: the last story in the
 * list would silently lose its Delete item. Fixed positioning has no such case,
 * and the only cost is that the menu has to be closed when its row scrolls out
 * from under it.
 *
 * The placement is measured, not guessed: the menu is rendered, its real height
 * read in a layout effect before paint, and it flips above the button if there
 * is no room below. A fixed clearance constant would be wrong the moment an item
 * was added.
 */

import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import type { Story } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { IconBook, IconCopy, IconMore, IconTrash } from './icons.tsx';

/** Keeps the menu off the window edges. */
const MARGIN = 8;
const GAP = 4;

export function StoryActions({ story }: { story: Story }) {
  const openDialog = useStore((state) => state.openDialog);
  const duplicateStory = useStore((state) => state.duplicateStory);
  const archiveStory = useStore((state) => state.archiveStory);
  const openStory = useStore((state) => state.openStory);
  const activeStoryId = useStore((state) => state.activeStoryId);

  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);

  /* Place the menu from the row's live rect. Runs before paint, so the initial
     guess is never shown. */
  useLayoutEffect(() => {
    if (!open) return;
    const button = host.current?.getBoundingClientRect();
    const node = menu.current;
    if (!button || !node) return;

    const { width, height } = node.getBoundingClientRect();
    const below = button.bottom + GAP;
    const top =
      below + height <= window.innerHeight - MARGIN
        ? below
        : Math.max(MARGIN, button.top - GAP - height);

    /* Right-aligned to the button, which is where the control is, then pulled
       back inside the window. */
    const left = Math.min(
      Math.max(MARGIN, button.right - width),
      window.innerWidth - width - MARGIN,
    );

    setAt({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (): void => setOpen(false);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    /* A menu pinned to the viewport is wrong the moment its row moves, so any
       scroll anywhere dismisses it rather than letting it drift. */
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = 'flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] hover:bg-[var(--accent-soft)]';

  return (
    <div className="shrink-0" ref={host}>
      <button
        type="button"
        className="icon-btn"
        style={{ width: 24, height: 24 }}
        onClick={() => {
          setAt(null);
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Actions for ${story.title}`}
      >
        <IconMore size={13} />
      </button>

      {open ? (
        <>
          {/* Clicks on the row behind the menu must close it, not pick the story. */}
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={menu}
            className="animate-rise fixed z-50 w-[13rem] overflow-hidden rounded-lg border border-border py-1"
            style={{
              top: at?.top ?? 0,
              left: at?.left ?? 0,
              background: 'var(--panel-raised)',
              boxShadow: 'var(--shadow-3)',
              visibility: at ? 'visible' : 'hidden',
            }}
            role="menu"
            aria-label={`Actions for ${story.title}`}
          >
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                /* The dialog edits `bundle.story`, so it must be *this* row's
                   story on screen first — otherwise the menu would silently
                   open the active story's settings instead. */
                void (async () => {
                  if (story.id !== activeStoryId) await openStory(story.id);
                  openDialog({ kind: 'story-settings' });
                })();
              }}
            >
              <IconBook size={12} />
              Prompt settings
            </button>
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                void duplicateStory(story.id);
              }}
            >
              <IconCopy size={12} />
              Duplicate
            </button>
            <div className="divider my-1" />
            <button
              type="button"
              role="menuitem"
              className={item}
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                setOpen(false);
                archiveStory(story.id);
              }}
            >
              <IconTrash size={12} />
              Delete
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
