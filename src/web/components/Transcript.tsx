/**
 * The transcript.
 *
 * Scroll policy is deliberately conservative: the viewport only auto-sticks
 * while the writer is already at the bottom, so streaming never yanks the page
 * out from under someone reading back. Once they scroll up, a scroll-to-bottom
 * affordance appears with a count of how much has arrived since.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.ts';
import { Avatar } from './Avatar.tsx';
import { MessageBubble } from './MessageBubble.tsx';
import { Prose } from './Prose.tsx';
import { IconArrowDown, IconClose, IconPlus, IconSearch, IconSpark, IconStop } from './icons.tsx';

const STICK_THRESHOLD = 140;

/**
 * The text a message search reads.
 *
 * Every candidate, not just the visible one: a writer searching for a line they
 * know they wrote should find it even if they have since regenerated that turn.
 * The reasoning traces are deliberately excluded — they are the model's working,
 * not the story.
 */
function searchableText(message: { variants: string[]; speaker: string | null }): string {
  return `${message.speaker ?? ''} ${message.variants.join(' ')}`.toLowerCase();
}

export function Transcript() {
  const bundle = useStore((state) => state.bundle);
  const streaming = useStore((state) => state.streaming);
  const abort = useStore((state) => state.abort);
  const activeScene = useStore((state) => state.activeScene);
  const filter = useStore((state) => state.messageFilter);
  const setMessageFilter = useStore((state) => state.setMessageFilter);
  const searchOpen = useStore((state) => state.messageSearchOpen);
  const setSearchOpen = useStore((state) => state.setMessageSearchOpen);

  const scroller = useRef<HTMLDivElement | null>(null);
  const searchField = useRef<HTMLInputElement | null>(null);
  const [stuck, setStuck] = useState(true);
  const [arrivedSince, setArrivedSince] = useState(0);
  const [sceneId, setSceneId] = useState<string | null>(null);

  const scene = activeScene();

  const needle = filter.trim().toLowerCase();

  const messages = useMemo(() => {
    const all = bundle?.messages ?? [];
    if (!scene) return all;
    const mine = all.filter((message) => message.sceneId === scene.id);
    // Older stories can carry turns from a scene that no longer exists; showing
    // them beats hiding someone's writing.
    return mine.length > 0 ? mine : all;
  }, [bundle, scene]);

  /* The panel's `Search messages` row opens this, and it filters the transcript in
     place rather than opening a second list: the turn you were looking for is a
     turn, and reading it in the conversation is the point. */
  const shown = useMemo(
    () => (needle === '' ? messages : messages.filter((message) => searchableText(message).includes(needle))),
    [messages, needle],
  );

  const closeSearch = (): void => {
    setSearchOpen(false);
    setMessageFilter('');
  };

  /* The field is focused when it appears, because the row that opened it was a
     deliberate act — and not on every render, or the scroll-stick effect would
     steal focus mid-word. */
  useEffect(() => {
    if (searchOpen) searchField.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (scene && scene.id !== sceneId) setSceneId(scene.id);
  }, [scene, sceneId]);

  const atBottom = useCallback((node: HTMLDivElement): boolean => {
    return node.scrollHeight - node.scrollTop - node.clientHeight < STICK_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((behaviour: ScrollBehavior = 'smooth') => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: behaviour });
    setStuck(true);
    setArrivedSince(0);
  }, []);

  /* Track stickiness; do not fight the pointer. */
  const onScroll = (): void => {
    const node = scroller.current;
    if (!node) return;
    const bottom = atBottom(node);
    setStuck(bottom);
    if (bottom) setArrivedSince(0);
  };

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    // `scrollend` is the honest signal; the fallback below covers older engines.
    const handle = (): void => onScroll();
    node.addEventListener('scrollend', handle);
    return () => node.removeEventListener('scrollend', handle);
  });

  /* Auto-stick while streaming, but only when already at the bottom. */
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (stuck) {
      node.scrollTop = node.scrollHeight;
    } else if (streaming.active) {
      setArrivedSince((count) => count + 1);
    }
  }, [streaming.text, streaming.active, shown.length, stuck]);

  /* A fresh story or scene jump lands at the bottom. */
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    setStuck(true);
    setArrivedSince(0);
  }, [bundle?.story.id, sceneId]);

  if (!bundle) return null;

  const streamedId = streaming.active ? streaming.messageId : null;
  const showEmpty = shown.length === 0 && !streaming.active && needle === '';
  const noMatches = needle !== '' && shown.length === 0;

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" aria-label="Transcript">
      {/* The scene lives in the app header now, with everything else that is
          chrome. All this keeps is the stop control, which only appears while
          there is something to stop. */}
      {streaming.active ? (
        <div className="flex shrink-0 justify-center pt-2">
          <button type="button" className="btn btn-danger" onClick={abort}>
            <IconStop size={11} />
            Stop
          </button>
        </div>
      ) : null}

      {/* The message filter. The row that opens it lives in the story panel; the
          field lives here, because a search of the transcript belongs on the
          transcript. It filters rather than navigating, so the turn you were
          looking for is read in its conversation. */}
      {searchOpen ? (
        <div className="mb-1 flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5" style={{ background: 'var(--accent-soft)' }}>
          <span className="eyebrow eyebrow-accent shrink-0">Search</span>
          <input
            ref={searchField}
            className="field field-sm min-w-0 flex-1"
            type="search"
            value={filter}
            placeholder="Find a turn — a name, a phrase, a line of dialogue"
            aria-label="Search this conversation's turns"
            onChange={(event) => setMessageFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch();
            }}
          />
          <span className="num shrink-0 text-[11px] text-faint">
            {needle === ''
              ? `${messages.length} turn${messages.length === 1 ? '' : 's'}`
              : `${shown.length} of ${messages.length}`}
          </span>
          <button
            type="button"
            className="icon-btn shrink-0"
            style={{ width: 24, height: 24 }}
            onClick={closeSearch}
            aria-label="Close the message search"
            title="Show every turn again"
          >
            <IconClose size={12} />
          </button>
        </div>
      ) : null}

      <div
        ref={scroller}
        className="texture-paper min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={streaming.active}
      >
        <div className="mx-auto w-full max-w-[52rem] px-3 py-5 sm:px-6 sm:py-8">
          {showEmpty ? <EmptyTranscript /> : null}

          {noMatches ? (
            <div className="animate-rise mx-auto max-w-[46rem] py-6 text-center">
              <div className="eyebrow">Nothing matches</div>
              <p className="mt-1.5 text-[13px] leading-snug text-faint">
                No turn in this conversation carries “{filter.trim()}”. The search reads every candidate
                generation and the speaker's name.
              </p>
              <button type="button" className="btn mt-3" onClick={closeSearch}>
                <IconSearch size={12} />
                Clear the search
              </button>
            </div>
          ) : null}

          <div className="space-y-5 sm:space-y-6">
            {shown.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                streaming={Boolean(streamedId && streamedId === message.id && streaming.active)}
                {...(streamedId === message.id
                  ? { pendingText: streaming.text, pendingReasoning: streaming.reasoning }
                  : {})}
              />
            ))}

            {/* A turn that has not been persisted yet (no `start` frame seen). */}
            {streaming.active && !streamedId && (streaming.text || streaming.reasoning) ? (
              <article className="flex w-full gap-2.5" aria-label="Narrator turn">
                <Avatar name="Narrator" size="md" className="mt-0.5" />
                <div className="flex min-w-0 max-w-[min(100%,44rem)] flex-col items-start">
                  <div className="mb-1 flex items-baseline gap-1.5 px-1">
                    <span className="font-display text-[12.5px] font-semibold text-dim">Narrator</span>
                    <span className="chip chip-hit animate-pulse-soft">streaming</span>
                  </div>
                  <div className="bubble bubble-narrator">
                    <Prose text={streaming.text} streaming />
                  </div>
                </div>
              </article>
            ) : null}

            {/* Inline agentic activity. Folded by default: it is a record of what
                the turn did, not part of the turn. */}
            {streaming.tools.length > 0 || streaming.notes.length > 0 ? (
              <details className="w-full rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-faint select-none">
                  <IconSpark size={11} />
                  <span className="eyebrow">Agent activity this turn</span>
                  <span className="num">
                    {streaming.tools.length + streaming.notes.length} event
                    {streaming.tools.length + streaming.notes.length === 1 ? '' : 's'}
                  </span>
                </summary>
                {streaming.tools.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {streaming.tools.map((tool, index) => (
                      <li key={`${tool.name}-${index}`} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                        <span className={`chip ${tool.ok ? 'chip-hit' : 'chip-miss'}`}>{tool.name}</span>
                        <span className="min-w-0 flex-1 truncate text-dim" title={tool.args}>
                          {tool.summary || tool.args}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {streaming.notes.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {streaming.notes.map((note, index) => (
                      <li key={`${note.kind}-${index}`} className="text-[12px] leading-snug text-dim">
                        <span className="chip mr-2">{note.kind}</span>
                        {note.body}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </details>
            ) : null}

            {streaming.tips.length > 0 ? (
              <details
                className="w-full rounded-lg border border-border p-2.5"
                style={{ background: 'var(--accent-soft)' }}
              >
                <summary className="flex cursor-pointer list-none items-center gap-1.5 select-none">
                  <IconSpark size={11} className="text-accent" />
                  <span className="eyebrow eyebrow-accent">Cache advice for the next turn</span>
                  <span className="num text-[11px] text-faint">{streaming.tips.length}</span>
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {streaming.tips.map((tip) => (
                    <li key={tip} className="text-[12px] leading-snug text-dim">
                      {tip}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {streaming.error ? (
              <div className="w-full rounded-lg border p-3"
                style={{ borderColor: 'color-mix(in oklab, var(--danger) 45%, var(--border))', background: 'color-mix(in oklab, var(--danger) 8%, transparent)' }}
                role="alert"
              >
                <div className="eyebrow mb-1" style={{ color: 'var(--danger)' }}>
                  The turn failed
                </div>
                <p className="text-[12.5px] leading-snug">{streaming.error}</p>
                <p className="mt-1 text-[11px] text-faint">
                  Nothing was billed for tokens that never arrived. Retry, or run Diagnose from the Cost panel.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {!stuck ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            className="btn pointer-events-auto shadow-2"
            onClick={() => scrollToBottom()}
            aria-label="Scroll to the newest turn"
          >
            <IconArrowDown size={12} />
            {arrivedSince > 0 ? 'New text below' : 'Latest turn'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function EmptyTranscript() {
  const stories = useStore((state) => state.stories);
  const openDialog = useStore((state) => state.openDialog);

  return (
    <div className="animate-rise mx-auto max-w-[46rem] py-6">
      <div className="eyebrow eyebrow-accent">Nothing written yet</div>
      <h2 className="mt-2 text-[26px] leading-tight sm:text-[32px]">
        The page is blank, and that is the cheapest it will ever be.
      </h2>
      <p className="mt-3 max-w-[54ch] font-serif text-[15px] leading-[1.72] text-dim">
        Every turn you write leaves a cache prefix behind it. Edit the contract, the genre or the style and the prefix
        breaks — the model re-reads the whole story at the miss price, fifty times the cost of a hit. Leave them alone
        and each new paragraph rides on the last one for almost nothing.
      </p>
      <p className="mt-3 max-w-[54ch] font-serif text-[15px] leading-[1.72] text-dim">
        So write a paragraph below, or start from one of these. Everything the studio does after that is aimed at
        keeping that prefix intact.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => openDialog({ kind: 'new-story' })}>
          <IconPlus size={13} />
          New story
        </button>
        {stories.length === 0 ? (
          <button type="button" className="btn" onClick={() => openDialog({ kind: 'import-export' })}>
            Import a card
          </button>
        ) : null}
      </div>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <div className="card p-3">
          <div className="eyebrow">What the meter means</div>
          <p className="mt-1.5 text-[12.5px] leading-snug text-dim">
            The composer measures the exact payload of your next turn before spending anything. Green is cache — tokens
            the provider already holds on disk. Red is re-reading them.
          </p>
        </div>
        <div className="card p-3">
          <div className="eyebrow">Why pin a turn</div>
          <p className="mt-1.5 text-[12.5px] leading-snug text-dim">
            Pinned turns freeze high in the prefix. Windowing can trim everything else, but pinned turns stay — so the
            tokens they cost are paid once and hit forever after.
          </p>
        </div>
      </div>
    </div>
  );
}
