/**
 * Who the model reads as you, and the one place to change it mid-story.
 *
 * This is the only control the composer gained for character chats, and it earns
 * its place by the product's own rule: show something while writing only if the
 * writer must act on it. Your persona is not instrumentation — it is the speaker
 * of every turn you write, and until now it was only changeable by opening the
 * story's persona editor, four clicks into the payload rail. In a 1:1 chat, where
 * "who am I talking to them as" is the whole premise, that was the wrong distance.
 *
 * Switching is deliberately immediate, and deliberately not free. The persona sits
 * high in the payload (volatility 2), so changing it invalidates that block and
 * everything behind it — the cast and the world in front of it stay cached, and
 * every turn after the switch caches again from the new prefix. That trade is the
 * writer's to make, so it is stated in the menu rather than hidden by a confirm
 * dialog. The copy is short because the meter beside this chip then shows the real
 * number on the very next turn.
 *
 * The editor (`Cast` → a persona card) is still where a persona is *written*.
 * This control only picks one.
 */

import { useEffect, useRef, useState } from 'react';
import type { Persona } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { activePersona } from '../speakers.ts';
import { Avatar } from './Avatar.tsx';
import { IconCheck, IconChevronDown } from './icons.tsx';

export function PersonaSwitch() {
  const bundle = useStore((state) => state.bundle);
  const streaming = useStore((state) => state.streaming);
  const updateStory = useStore((state) => state.updateStory);

  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);

  /* Dismissal: a click outside, or Escape. The menu is absolutely positioned
     inside the composer's own row — unlike the story rows, nothing above it
     scrolls, so it needs no viewport pinning and cannot be clipped. */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (host.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const persona = activePersona(bundle);
  if (!bundle || !persona) return null;

  const busy = streaming.active;
  const pool = bundle.personas;

  return (
    <div className="relative" ref={host}>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-colors"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)', opacity: busy ? 0.6 : 1 }}
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={
          busy
            ? 'Writing as — wait for this turn to finish before switching'
            : 'Who the model reads as you on every turn you write'
        }
      >
        <Avatar name={persona.name} src={persona.avatar} size="sm" />
        <span className="max-w-[8rem] truncate text-dim">{persona.name}</span>
        <span className="shrink-0 text-faint">
          <IconChevronDown size={11} />
        </span>
      </button>

      {open ? (
        <div
          className="animate-rise absolute bottom-full left-0 z-50 mb-1.5 w-[16rem] overflow-hidden rounded-lg border border-border py-1"
          style={{ background: 'var(--panel-raised)', boxShadow: 'var(--shadow-3)' }}
          role="listbox"
          aria-label="Who the model reads as you"
        >
          <div className="eyebrow px-2.5 pt-1 pb-1.5">Writing as</div>
          {pool.map((option) => (
            <PersonaOption
              key={option.id}
              persona={option}
              selected={option.id === persona.id}
              onPick={() => {
                setOpen(false);
                if (option.id !== persona.id) void updateStory({ personaId: option.id });
              }}
            />
          ))}
          <p className="mt-1 border-t border-border px-2.5 pt-1.5 text-[10.5px] leading-snug text-faint">
            {pool.length < 2
              ? 'Only one persona here. Add another from the Cast page, then switch between them.'
              : 'Switching re-prices everything from the persona block on. The cast and the world in front of it stay cached, and the turns after it cache again.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PersonaOption({
  persona,
  selected,
  onPick,
}: {
  persona: Persona;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] hover:bg-[var(--accent-soft)]"
      onClick={onPick}
    >
      <Avatar name={persona.name} src={persona.avatar} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{persona.name}</span>
        {persona.description ? (
          <span className="block truncate text-[10.5px] text-faint">{persona.description.split('\n')[0]}</span>
        ) : null}
      </span>
      {selected ? (
        <span className="shrink-0" style={{ color: 'var(--accent)' }}>
          <IconCheck size={12} />
        </span>
      ) : null}
    </button>
  );
}
