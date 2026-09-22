/**
 * Per-message controls.
 *
 * The pin control is labelled as what it actually is — freezing the message high
 * in the cache prefix — because in this product cache position is a first-class
 * editorial decision, not a bookmark.
 */

import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import type { Message } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconEyeOff,
  IconPen,
  IconPin,
  IconRefresh,
  IconSkip,
  IconSplit,
  IconTrash,
  IconUsers,
} from './icons.tsx';

export type MessageActionsProps = {
  message: Message;
  text: string;
};

export function MessageActions({ message, text }: MessageActionsProps) {
  const patchMessage = useStore((state) => state.patchMessage);
  const deleteMessage = useStore((state) => state.deleteMessage);
  const selectVariant = useStore((state) => state.selectVariant);
  const regenerate = useStore((state) => state.regenerate);
  const continueFrom = useStore((state) => state.continueFrom);
  const branchFrom = useStore((state) => state.branchFrom);
  const streaming = useStore((state) => state.streaming.active);
  const toast = useStore((state) => state.toast);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [copied, setCopied] = useState(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  useEffect(() => {
    if (!editing) return;
    const node = textarea.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
    node.style.height = 'auto';
    node.style.height = `${Math.min(560, node.scrollHeight)}px`;
  }, [editing]);

  const variantCount = message.variants.length;
  const index = message.activeVariant;
  const usage = message.usage;
  const isUser = message.role === 'user';
  const bundle = useStore((state) => state.bundle);
  const [speakerOpen, setSpeakerOpen] = useState(false);

  /** The cast, plus the narrator, as attribution targets for this turn. */
  const speakers = useMemo(() => {
    const names = (bundle?.characters ?? []).map((character) => character.name);
    return ['Narrator', ...names.filter((name) => name !== 'Narrator')];
  }, [bundle]);

  const currentSpeaker = message.speaker ?? (isUser ? 'You' : 'Narrator');

  const attribute = (name: string): void => {
    setSpeakerOpen(false);
    const next = name === (isUser ? 'You' : 'Narrator') ? null : name;
    if (next === message.speaker) return;
    void patchMessage(message.id, { speaker: next });
  };

  const commit = async (): Promise<void> => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === text) return;
    const variants = [...message.variants];
    variants[index] = next;
    await patchMessage(message.id, { variants });
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      toast({ kind: 'error', title: 'Clipboard unavailable', detail: 'Your browser blocked the copy.' });
    }
  };

  /* Swipe: left goes forward through variants, right regenerates a new one. */
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (event: TouchEvent<HTMLDivElement>): void => {
    const point = event.touches[0];
    if (!point) return;
    touch.current = { x: point.clientX, y: point.clientY };
  };
  const onTouchEnd = (event: TouchEvent<HTMLDivElement>): void => {
    const start = touch.current;
    touch.current = null;
    const point = event.changedTouches[0];
    if (!start || !point || streaming) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) {
      // swipe left → new variant
      void regenerate(message.id);
    } else if (index < variantCount - 1) {
      void selectVariant(message.id, index + 1);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-1 gap-y-1.5"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Always available where there is room; hover-revealed on a pointer. The
          controls are the affordance, so they start dim rather than invisible —
          a feature nobody can find is a feature that does not exist. */}
      <div className="flex items-center gap-0.5 opacity-55 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        {variantCount > 1 ? (
          <div className="mr-1 flex items-center gap-0.5 rounded-md border border-border px-0.5" style={{ background: 'var(--bg-sunken)' }}>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              disabled={index <= 0 || streaming}
              onClick={() => void selectVariant(message.id, index - 1)}
              aria-label="Previous variant"
            >
              <IconChevronLeft size={11} />
            </button>
            <span className="num px-0.5 text-[10.5px] text-dim" aria-live="polite">
              {index + 1}/{variantCount}
            </span>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              disabled={index >= variantCount - 1 || streaming}
              onClick={() => void selectVariant(message.id, index + 1)}
              aria-label="Next variant"
            >
              <IconChevronRight size={11} />
            </button>
          </div>
        ) : null}

        {!isUser ? (
          <button
            type="button"
            className="icon-btn"
            disabled={streaming}
            onClick={() => void regenerate(message.id)}
            aria-label="Regenerate as a new variant"
            title="Regenerate — a new variant sharing the same cached prefix"
          >
            <IconRefresh size={13} />
          </button>
        ) : null}

        <button
          type="button"
          className={`icon-btn ${editing ? 'icon-btn-on' : ''}`}
          onClick={() => setEditing((value) => !value)}
          aria-label={editing ? 'Finish editing' : 'Edit this message'}
          aria-pressed={editing}
          title="Edit inline"
        >
          <IconPen size={13} />
        </button>

        <button
          type="button"
          className={`icon-btn ${message.speaker ? 'icon-btn-on' : ''}`}
          onClick={() => setSpeakerOpen((value) => !value)}
          aria-expanded={speakerOpen}
          aria-label="Who is speaking"
          title="Attribute this turn to a character — their portrait and name appear with it"
        >
          <IconUsers size={13} />
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={() => void copy()}
          aria-label="Copy message text"
          title="Copy"
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        </button>

        <button
          type="button"
          className={`icon-btn ${message.pinned ? 'icon-btn-on' : ''}`}
          onClick={() => void patchMessage(message.id, { pinned: !message.pinned })}
          aria-pressed={message.pinned}
          aria-label={message.pinned ? 'Unpin from the cache prefix' : 'Pin high in the cache prefix'}
          title={
            message.pinned
              ? 'Pinned — frozen high in the cache prefix, so it is never trimmed'
              : 'Pin — freeze this turn high in the cache prefix so windowing can never evict it'
          }
        >
          <IconPin size={13} />
        </button>

        <button
          type="button"
          className={`icon-btn ${message.disabled ? 'icon-btn-on' : ''}`}
          onClick={() => void patchMessage(message.id, { disabled: !message.disabled })}
          aria-pressed={message.disabled}
          aria-label={message.disabled ? 'Include in the payload again' : 'Exclude from the payload'}
          title={
            message.disabled
              ? 'Excluded from the payload — the transcript still shows it, the model never sees it'
              : 'Exclude from the payload without deleting it'
          }
        >
          <IconEyeOff size={13} />
        </button>

        <button
          type="button"
          className="icon-btn"
          disabled={streaming}
          onClick={() => void branchFrom(message.id)}
          aria-label="Branch a new story from here"
          title="Branch from here — a new story carrying this cached prefix forward"
        >
          <IconSplit size={13} />
        </button>

        <button
          type="button"
          className="icon-btn"
          disabled={streaming}
          onClick={() => void continueFrom(message.id)}
          aria-label="Continue the scene from here"
          title="Continue from here"
        >
          <IconSkip size={13} />
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            useStore.getState().openDialog({
              kind: 'confirm',
              title: 'Delete this turn?',
              body: 'The message leaves the payload and the transcript. Pinned turns above it keep their cache position.',
              confirmLabel: 'Delete turn',
              danger: true,
              run: () => void deleteMessage(message.id),
            });
          }}
          aria-label="Delete this turn"
          title="Delete"
        >
          <IconTrash size={13} />
        </button>
      </div>

      {speakerOpen ? (
        <div
          className="mt-1.5 w-full rounded-lg border border-border p-2"
          style={{ background: 'var(--bg-sunken)' }}
          role="group"
          aria-label="Attribute this turn to"
        >
          <div className="eyebrow mb-1.5">Who is speaking</div>
          <div className="flex flex-wrap gap-1.5">
            {speakers.map((name) => (
              <button
                key={name}
                type="button"
                className={`btn ${name === currentSpeaker ? 'btn-primary' : ''}`}
                style={{ padding: '0.2rem 0.45rem', fontSize: 11.5 }}
                onClick={() => attribute(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="mt-2 w-full min-w-[min(100%,24rem)]">
          <label className="sr-only" htmlFor={`edit-${message.id}`}>
            Message text
          </label>
          <textarea
            id={`edit-${message.id}`}
            ref={textarea}
            className="field resize-none font-serif text-[14px] leading-relaxed"
            value={draft}
            rows={4}
            onChange={(event) => {
              setDraft(event.target.value);
              const node = event.currentTarget;
              node.style.height = 'auto';
              node.style.height = `${Math.min(560, node.scrollHeight)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setEditing(false);
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void commit();
              }
            }}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={() => void commit()}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setDraft(text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <span className="text-[10.5px] text-faint">Esc cancels · Cmd/Ctrl+Enter saves</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
