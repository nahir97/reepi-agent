/**
 * The Creation assistant: a conversation that builds the studio's content.
 *
 * It is app-scoped, and that is the design, not a detail. The assistant is not a
 * story: its chat is its own (persisted, reloadable), it is reachable before any
 * story exists, and the story a turn may write into is something the writer points
 * it at. Nothing here reads `activeStoryId` — a turn that wrote into "whatever was
 * open" could land in a world the writer was not looking at.
 *
 * **The shape is the studio's chat.** A page whose whole premise is that you talk
 * to it rendered as a form on top of a log: the ask was a textarea in a card, the
 * thread was flat rows under it, and the writer's own turn was not even a bubble.
 * The form was easy to build and wrong to use — it announced "fill this in and
 * submit" where the design says "say something and it answers". So the page is the
 * transcript and the composer: bubbles, avatars, a scrolling thread above, the
 * input pinned at the bottom, exactly as the narration surface works.
 *
 * What each part is here for:
 *
 * - **The conversation**, read back from the server, receipts included. A receipt
 *   read a week later has to say what that turn did *and* what it was allowed to
 *   do, which is why it is stored rather than re-derived from the current state.
 * - **The target picker**, one labelled control in the composer: no story, or one
 *   story. "No story" is a real way to work — characters become library cards with
 *   no home, templates are app-wide, and a whole story can be created by the turn.
 *   It sits with the input because it is part of what the message is, the same way
 *   a persona or an author note is on the narration surface — not a form field to
 *   fill in before the chat begins.
 * - **The rewrite consent**, off by default and next to the picker, because
 *   replacing a block that already has text re-prices the cache prefix from there
 *   on and the writer's own prose is not something a model gets to overwrite
 *   quietly.
 * - **The prefix movement**, read from the server's own plan and folded into the
 *   turn's receipt: after a write, the one number that matters is which frozen
 *   blocks moved.
 * - **Cost**, one action away in the receipt rather than printed on every bubble.
 *   The bubble is the writing; the accounting has never earned a permanent place on
 *   a writing surface in this studio.
 *
 * Stopping is honest: a stopped turn records nothing and writes nothing, so the
 * ask stays in the box for the writer to finish or re-send.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTokens, formatUsd } from '../../shared/cost.ts';
import type { CreatorMessage } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { PageBand } from './panel.tsx';
import {
  IconAlert,
  IconCheck,
  IconChevronDown,
  IconFeather,
  IconNote,
  IconPlus,
  IconSend,
  IconStop,
  IconTrash,
} from './icons.tsx';

/** `story` = the world bible block. Named in the writer's language, not the enum's. */
const BLOCK_LABEL: Record<string, string> = {
  contract: 'voice & format contract',
  genre: 'genre & tone',
  style: 'prose style',
  story: 'story bible',
  scenario: 'scenario',
  exemplars: 'exemplars',
  instruct: 'post-history instruction',
};

/**
 * What a receipt row calls itself. `cast` is the one that needs saying out loud —
 * it is not a new card, it is an existing one now in a story's payload.
 */
const KIND_LABEL: Record<string, string> = {
  story: 'story',
  character: 'character',
  lore: 'lore entry',
  template: 'template',
  cast: 'added to cast',
};

/** Field names, in the writer's language. */
const FIELD_LABEL: Record<string, string> = {
  name: 'name',
  tagline: 'tagline',
  description: 'description',
  personality: 'personality',
  speech: 'speech',
  scenario: 'scenario',
  exampleDialogue: 'example dialogue',
  title: 'title',
  body: 'body',
  keys: 'trigger keys',
  position: 'position',
  depth: 'depth',
  priority: 'priority',
  constant: 'always on',
  bible: 'story bible',
  genre: 'genre & tone',
  style: 'prose style',
  contract: 'contract',
  exemplars: 'exemplars',
  instruct: 'instruction',
};

type Starter = { label: string; request: string; needsTarget: boolean };

/** The things this pass is genuinely good at, phrased as the ask. */
const STARTERS: Starter[] = [
  {
    label: 'Write a character',
    request: 'Write one character: a name, a tagline, who they are, how they behave, and how they speak.',
    needsTarget: false,
  },
  {
    label: 'Start a story from a pitch',
    request: 'Start a new story from this pitch: ',
    needsTarget: false,
  },
  {
    label: 'Draft a prompt template',
    request:
      'Draft a reusable prompt template for tight, concrete prose — a style block a writer could apply to any story.',
    needsTarget: false,
  },
  {
    label: 'File a lorebook',
    request:
      'File a lorebook of four entries about this world: the most important place, faction, custom and piece of history. Give each one trigger keys so it fires when it matters.',
    needsTarget: true,
  },
  {
    label: 'Write the scenario',
    request: 'Write the scenario block: the situation this story opens into, in a short paragraph.',
    needsTarget: true,
  },
  {
    label: 'Write the story bible',
    request:
      'Write the story bible: the world’s facts, places, rules and history, as a set of short declarative lines the narrator can act on.',
    needsTarget: true,
  },
];

/** Auto-stick tolerance, the same figure the narration transcript uses. */
const STICK_THRESHOLD = 140;

export function CreatorPage() {
  const creator = useStore((state) => state.creator);
  const stories = useStore((state) => state.stories);
  const loadCreatorThread = useStore((state) => state.loadCreatorThread);
  const sendCreator = useStore((state) => state.sendCreator);
  const stopCreator = useStore((state) => state.stopCreator);
  const startNewCreatorChat = useStore((state) => state.startNewCreatorChat);
  const setCreatorTarget = useStore((state) => state.setCreatorTarget);
  const openStory = useStore((state) => state.openStory);
  const setPage = useStore((state) => state.setPage);
  const plan = useStore((state) => state.plan);
  const busy = useStore((state) => state.busy);
  const runWarm = useStore((state) => state.runWarm);

  const [text, setText] = useState('');
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [stuck, setStuck] = useState(true);

  const box = useRef<HTMLTextAreaElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadCreatorThread();
  }, [loadCreatorThread]);

  useEffect(() => {
    box.current?.focus();
  }, []);

  const atBottom = useCallback((node: HTMLDivElement): boolean => {
    return node.scrollHeight - node.scrollTop - node.clientHeight < STICK_THRESHOLD;
  }, []);

  /* Entering the page, and after a new turn lands, the newest message is what the
     writer came to read. A reader who scrolled up is not dragged back down. */
  const scrollToEnd = useCallback((behaviour: ScrollBehavior = 'smooth') => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: behaviour });
    stuckRef.current = true;
    setStuck(true);
  }, []);

  const onScroll = (): void => {
    const node = scroller.current;
    if (!node) return;
    const bottom = atBottom(node);
    stuckRef.current = bottom;
    setStuck(bottom);
  };

  /* Keep the newest turn in view as the conversation grows — but only while the
     writer is already at the end of it. */
  const stuckRef = useRef(true);
  useEffect(() => {
    const node = scroller.current;
    if (node && stuckRef.current) node.scrollTop = node.scrollHeight;
  }, [creator.thread.length, creator.pending]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  /* Grow with the content, capped so the thread keeps most of the screen. */
  const resize = (): void => {
    const node = box.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(180, Math.max(46, node.scrollHeight))}px`;
  };

  useEffect(resize, [text]);

  const target = useMemo(
    () => stories.find((story) => story.id === creator.targetStoryId) ?? null,
    [stories, creator.targetStoryId],
  );
  const starters = useMemo(
    () => STARTERS.filter((starter) => !starter.needsTarget || target !== null),
    [target],
  );
  const threadCost = useMemo(
    () => creator.thread.reduce((sum, message) => sum + (message.receipt?.costUsd ?? 0), 0),
    [creator.thread],
  );
  const asking = creator.pending !== null;

  /* What the server's own plan says moved, and only when there is a baseline to
     have moved from: on a story with no recorded turn every block reads as
     changed, and claiming "the prefix moved" there would be a lie about a cache
     that was never warm. */
  const hasBaseline = plan !== null && plan.previousHitRate !== null;
  const moved = useMemo(
    () => (hasBaseline ? plan.blocks.filter((block) => block.changed) : []),
    [plan, hasBaseline],
  );

  const submit = async (): Promise<void> => {
    const request = text.trim();
    if (!request || asking) return;
    await sendCreator({ text: request, allowOverwrite });
    /* Keep the ask if the turn failed, so the writer can fix and re-send it. */
    if (!useStore.getState().creator.error) setText('');
    box.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <PageBand
        onBack={() => setPage('story')}
        title="Creation assistant"
        hint={
          creator.thread.length > 0 ? (
            <>
              {`${Math.ceil(creator.thread.length / 2)} turn${creator.thread.length > 2 ? 's' : ''}`}
              <span className="hidden sm:inline">{` · ${formatUsd(threadCost)}`}</span>
              {` · ${target ? `writing into ${target.title}` : 'no story selected'}`}
            </>
          ) : target ? (
            `writing into ${target.title}`
          ) : (
            'no story selected'
          )
        }
        actions={
          creator.thread.length > 0 && !asking ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0.3rem 0.55rem' }}
              onClick={() => void startNewCreatorChat()}
              title="Start a new chat. Nothing it wrote is deleted."
            >
              <IconTrash size={11} />
              New chat
            </button>
          ) : null
        }
      />

      {/* -------------------------------------------------------- the thread */}

      <section className="relative flex min-h-0 flex-1 flex-col" aria-label="Conversation with the creation assistant">
        <div
          ref={scroller}
          className="texture-paper min-h-0 flex-1 overflow-y-auto overscroll-contain"
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={asking}
        >
          <div className="mx-auto w-full max-w-[52rem] px-3 py-5 sm:px-6 sm:py-7">
            {creator.loaded && creator.thread.length === 0 && !asking ? (
              <Opening starters={starters} onDraft={(request) => {
                setText(request);
                box.current?.focus();
              }} />
            ) : null}

            <div className="space-y-5 sm:space-y-6">
              {creator.thread.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  targetTitle={stories.find((story) => story.id === message.targetStoryId)?.title ?? null}
                  onOpenStory={(storyId) => {
                    void openStory(storyId);
                    setPage('story');
                  }}
                />
              ))}

              {/* The ask in flight, drawn as the writer's own bubble so the
                  surface answers the moment it is spoken, not thirty seconds later. */}
              {creator.pending !== null ? (
                <UserBubble body={creator.pending} targetTitle={target?.title ?? null} />
              ) : null}

              {asking ? (
                <article className="flex w-full gap-2.5" aria-label="Creation assistant is working">
                  <AssistantMark />
                  <div className="min-w-0 max-w-[min(100%,44rem)]">
                    <div className="mb-1 flex items-baseline gap-1.5 px-1">
                      <span className="font-display text-[12.5px] font-semibold text-dim">Creation assistant</span>
                    </div>
                    <div className="bubble bubble-narrator">
                      <p className="flex items-center gap-2 text-[12.5px] text-faint" role="status">
                        <span className="animate-pulse-soft" style={{ color: 'var(--accent)' }}>
                          <IconFeather size={12} />
                        </span>
                        Reading the world and writing into it…
                      </p>
                    </div>
                  </div>
                </article>
              ) : null}
            </div>

            {/* The prefix movement the last write caused, folded shut. It is a real
                consequence of what the assistant did, so where it has something to
                say it says it once, and one action opens the detail. */}
            {moved.length > 0 ? (
              <details
                className="group mt-5 w-full rounded-lg border border-border p-2.5"
                style={{ background: 'var(--bg-sunken)' }}
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 select-none">
                  <span
                    className="shrink-0 transition-transform duration-150 -rotate-90 group-open:rotate-0"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    <IconChevronDown size={10} />
                  </span>
                  <span className="eyebrow" style={{ color: 'var(--warn)' }}>
                    Prefix moved
                  </span>
                  <span className="num text-[11.5px] text-dim">
                    {moved.length} block{moved.length === 1 ? '' : 's'} changed since the last cached turn
                  </span>
                </summary>
                <p className="num mt-2 text-[10.5px] text-faint">
                  {moved.map((block) => `${block.label} (${formatTokens(block.tokens)} tok)`).join(' · ')}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] leading-snug text-dim">
                  The next narration turn re-reads those blocks at the miss price. Warm the prefix deliberately
                  and afterwards they are hits again.
                  <button
                    type="button"
                    className="btn ml-auto"
                    style={{ padding: '0.25rem 0.5rem' }}
                    disabled={busy !== null}
                    onClick={() => void runWarm()}
                    title="Pay one deliberate miss-priced turn, then prove the prefix is being served from cache"
                  >
                    Warm it
                  </button>
                </div>
              </details>
            ) : null}
          </div>
        </div>

        {!stuck ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <button
              type="button"
              className="btn pointer-events-auto shadow-2"
              onClick={() => scrollToEnd()}
              aria-label="Scroll to the newest message"
            >
              Latest message
            </button>
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------------ the composer */}

      <section
        className="shrink-0 border-t border-border pb-safe"
        style={{ background: 'var(--panel)' }}
        aria-label="Message the creation assistant"
      >
        <div className="mx-auto w-full max-w-[52rem] px-3 pt-2.5 pb-3 sm:px-6">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0" style={{ color: target ? 'var(--text-dim)' : 'var(--text-faint)' }}>
                <IconNote size={12} />
              </span>
              <span className="sr-only">Write into</span>
              <select
                className="field field-sm w-auto max-w-[15rem] min-w-0"
                value={creator.targetStoryId ?? ''}
                onChange={(event) => setCreatorTarget(event.target.value || null)}
                title="Which story this chat may write into. No story means characters become library cards."
              >
                <option value="">No story — into your library</option>
                {stories.map((story) => (
                  <option key={story.id} value={story.id}>
                    {story.title}
                    {story.characterId ? ' (chat)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label
              className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-dim"
              title="Off by default. With it on, the assistant may replace a directive block that already has your text — which re-prices the prefix behind it."
            >              <input
                type="checkbox"
                className="shrink-0"
                checked={allowOverwrite}
                disabled={asking}
                onChange={(event) => setAllowOverwrite(event.target.checked)}
              />
              Allow rewriting
            </label>
          </div>

          <div
            className="flex items-end gap-2 rounded-xl border p-2 transition-colors"
            style={{
              background: 'var(--bg-sunken)',
              borderColor: asking ? 'color-mix(in oklab, var(--accent) 45%, var(--border))' : 'var(--border)',
              boxShadow: 'var(--shadow-1)',
            }}
          >
            <label className="sr-only" htmlFor="creator-request">
              Message the creation assistant
            </label>
            <textarea
              id="creator-request"
              ref={box}
              className="max-h-[180px] min-h-[46px] flex-1 resize-none bg-transparent px-1.5 py-1.5 font-serif text-[15px] leading-[1.65] outline-none"
              rows={2}
              value={text}
              placeholder={
                asking
                  ? 'Ask while it works — it will answer after this one.'
                  : target
                    ? 'Four lore entries about the drowned archive, and a steward who guards it.'
                    : 'Three characters for a rain-soaked port city, each with something to hide.'
              }
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                // IME safety: a composition Enter commits a candidate, never sends.
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />

            <div className="flex shrink-0 items-center gap-1">
              {asking ? (
                <button type="button" className="btn btn-danger h-[34px]" onClick={stopCreator} aria-label="Stop building">
                  <IconStop size={12} />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary h-[34px]"
                  onClick={() => void submit()}
                  disabled={text.trim().length === 0}
                  aria-label="Send your message"
                >
                  <IconSend size={13} />
                  Send
                </button>
              )}
            </div>
          </div>

          {creator.error ? (
            <p className="mt-2 text-[11.5px] leading-snug" style={{ color: 'var(--danger)' }} role="alert">
              {creator.error}
            </p>
          ) : null}

          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-faint">
            <span className="hidden sm:inline">Enter sends · Shift+Enter breaks the line</span>
            <span className="num ml-auto truncate">
              {target ? (
                `writing into ${target.title}`
              ) : (
                <>
                  <span className="sm:hidden">no story selected</span>
                  <span className="hidden sm:inline">no story selected · characters go to your library</span>
                </>
              )}
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- the opening */

/**
 * The first thing the writer sees: the assistant introducing itself, in the same
 * bubble shape every later answer arrives in, with the asks it is actually good at
 * offered as chips. A starter drafts the request into the box rather than sending
 * it, because the interesting part of "four lore entries" is the details a writer
 * adds before they press Enter.
 */
function Opening({ starters, onDraft }: { starters: Starter[]; onDraft: (request: string) => void }) {
  return (
    <div className="animate-rise mb-6">
      <article className="flex w-full gap-2.5">
        <AssistantMark />
        <div className="min-w-0 max-w-[min(100%,44rem)]">
          <div className="mb-1 flex items-baseline gap-1.5 px-1">
            <span className="font-display text-[12.5px] font-semibold text-dim">Creation assistant</span>
          </div>
          <div className="bubble bubble-narrator">
            <div className="font-serif text-[15px] leading-[1.68]">
              <p>
                I write the scaffolding, not the prose: character cards, lorebook entries, a story’s scenario and
                bible, and reusable prompt templates. I can also start a whole story from a pitch. I never write
                dialogue, and I never write your persona.
              </p>
              <p className="mt-3">
                Point me at a story with <em>Write into</em> to build inside one — or leave it on <em>No story</em> and
                I will write characters into your library and make a world when you ask for one.
              </p>
            </div>
          </div>
        </div>
      </article>

      <div className="mt-3 flex flex-wrap gap-1.5 pl-0 sm:pl-[3.25rem]">
        {starters.map((starter) => (
          <button key={starter.label} type="button" className="chip" onClick={() => onDraft(starter.request)}>
            <IconPlus size={10} />
            {starter.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- one message */

/** The assistant's mark: the studio's own feather, on the avatar circle's grid. */
function AssistantMark() {
  return (
    <span className="avatar mt-0.5" title="Creation assistant" aria-hidden="true">
      <IconFeather size={14} className="text-accent" />
    </span>
  );
}

function UserBubble({ body, targetTitle }: { body: string; targetTitle: string | null }) {
  return (
    <article className="flex w-full flex-col items-end" aria-label="Your message">
      <div className="mb-1 flex items-baseline gap-1.5 px-1">
        <span className="font-display text-[12.5px] font-semibold" style={{ color: 'var(--player)' }}>
          You
        </span>
      </div>
      <div className="bubble bubble-user" style={{ maxWidth: 'min(100%, 44rem)' }}>
        <p className="font-serif text-[15px] leading-[1.68] whitespace-pre-wrap">{body}</p>
      </div>
      <p className="num mt-1 px-1 text-end text-[10px] text-faint" title="Where this turn was allowed to write">
        {targetTitle ? `into ${targetTitle}` : 'no story selected'}
      </p>    </article>
  );
}

function Message({
  message,
  targetTitle,
  onOpenStory,
}: {
  message: CreatorMessage;
  targetTitle: string | null;
  onOpenStory: (storyId: string) => void;
}) {
  if (message.role === 'user') return <UserBubble body={message.body} targetTitle={targetTitle} />;

  const receipt = message.receipt;
  return (
    <article className="flex w-full gap-2.5" aria-label="Creation assistant turn">
      <AssistantMark />
      <div className="flex min-w-0 max-w-[min(100%,44rem)] flex-col items-start">
        <div className="mb-1 flex items-baseline gap-1.5 px-1">
          <span className="font-display text-[12.5px] font-semibold text-dim">Creation assistant</span>
          {message.allowOverwrite ? <span className="chip">rewriting allowed</span> : null}
        </div>

        <div className="bubble bubble-narrator">
          <p className="font-serif text-[15px] leading-[1.68] whitespace-pre-wrap">{message.body}</p>
        </div>

        {receipt ? (
          <Receipt
            receipt={receipt}
            messageTarget={message.targetStoryId}
            targetTitle={targetTitle}
            onOpenStory={onOpenStory}
          />
        ) : null}
      </div>
    </article>
  );
}

/* -------------------------------------------------------------- the receipt */

/**
 * What the turn did, folded shut.
 *
 * The row of chips and the token counts that used to sit under every answer now
 * live one action away, behind a line that still says the three things a writer
 * acts on: what moved, what it cost, and whether anything was refused. A receipt
 * is historical data — it says what happened, which is why it is read from the
 * message and never re-derived from the rows it names.
 */
function Receipt({
  receipt,
  messageTarget,
  targetTitle,
  onOpenStory,
}: {
  receipt: NonNullable<CreatorMessage['receipt']>;
  /** The story the message recorded, which is not the picker's current value. */
  messageTarget: string | null;
  targetTitle: string | null;
  onOpenStory: (storyId: string) => void;
}) {
  const wrote = receipt.created.length + receipt.updated.length;
  const refused = receipt.refused.length;
  const replaced = receipt.replacedBlocks.length;
  const empty = wrote === 0 && refused === 0 && replaced === 0;

  /* A turn that changed something starts with its receipt open: a write that
     re-prices the prefix must never be invisible. A turn that only answered leaves
     it folded, because there is nothing behind it to see. */
  const [open, setOpen] = useState(!empty);

  const counts = [
    wrote > 0 ? `${wrote} row${wrote === 1 ? '' : 's'}` : null,
    replaced > 0 ? `${replaced} block${replaced === 1 ? '' : 's'} rewritten` : null,
    refused > 0 ? `${refused} refused` : null,
  ].filter(Boolean);

  return (
    <details className="mt-1.5 w-full px-1" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[11px] text-faint select-none">
        <span className={`shrink-0 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}>
          <IconChevronDown size={10} />
        </span>
        <span className="eyebrow">Receipt</span>
        <span className="num">{empty ? 'nothing moved' : counts.join(' · ')}</span>
        <span className="num ml-auto">{formatUsd(receipt.costUsd)}</span>
      </summary>

      <div className="mt-1.5 rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
        {receipt.created.length > 0 ? (
          <ul className="space-y-1">
            {receipt.created.map((row) => (
              <li key={`${row.kind}-${row.id}`} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                <span className="chip chip-hit">
                  <IconCheck size={10} />
                  {KIND_LABEL[row.kind] ?? row.kind}
                </span>
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                {row.storyId === null && row.kind === 'character' ? (
                  <span className="chip shrink-0" title="No home story yet — any story can cast them.">
                    no home story
                  </span>
                ) : null}
                {row.tokens !== undefined ? (
                  <span className="num shrink-0 text-[10.5px] text-faint">{formatTokens(row.tokens)} tok</span>
                ) : null}
                {row.kind === 'story' ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '0.2rem 0.45rem' }}
                    onClick={() => onOpenStory(row.id)}
                  >
                    Open it
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {receipt.updated.length > 0 ? (
          <ul className={`space-y-1 ${receipt.created.length > 0 ? 'mt-1.5' : ''}`}>
            {receipt.updated.map((row, index) => (
              <li
                key={`${row.kind}-${row.name}-${index}`}
                className="flex flex-wrap items-center gap-2 text-[11.5px]"
              >
                <span className="chip">revised</span>
                {/* A block row *is* the block, so it is named in the writer's
                    language and has no second column of field names to repeat. */}
                <span className="min-w-0 flex-1 truncate">
                  {row.kind === 'block' ? (BLOCK_LABEL[row.name] ?? row.name) : row.name}
                </span>
                {row.kind === 'block' ? null : (
                  /* A card can be revised in seven fields at once, so this column
                     truncates rather than pushing the row past the bubble. */
                  <span className="num min-w-0 max-w-full truncate text-[10.5px] text-faint">
                    {row.fields.map((field) => FIELD_LABEL[field] ?? field).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {receipt.replacedBlocks.length > 0 ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug" style={{ color: 'var(--warn)' }}>
            <IconAlert size={11} className="mt-px shrink-0" />
            <span>
              Replaced {receipt.replacedBlocks.map((block) => BLOCK_LABEL[block] ?? block).join(', ')} — the prefix
              behind {receipt.replacedBlocks.length === 1 ? 'it' : 'them'} is re-priced next turn.
            </span>
          </p>
        ) : null}

        {receipt.refused.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {receipt.refused.map((row, index) => (
              <li key={`${row.target}-${index}`} className="text-[11px] leading-snug" style={{ color: 'var(--danger)' }}>
                {row.target}: {row.reason}
              </li>
            ))}
          </ul>
        ) : null}

        {wrote === 0 && refused === 0 && replaced === 0 ? (
          <p className="text-[11.5px] text-faint">
            This turn answered without writing anything. Nothing was re-priced.
          </p>
        ) : null}

        {/* Where the turn wrote, as recorded on the message rather than as the
            picker reads now — the writer may have re-pointed it since. A target
            whose story has gone says so instead of claiming "no story". */}
        <p className="num mt-1.5 text-[10px] text-faint">
          {targetLabel(receipt.newStoryId ? 'story' : messageTarget, targetTitle)}
          {` · written by ${receipt.model}`}
        </p>
      </div>
    </details>
  );
}

/**
 * Where one turn was allowed to write, in the writer's language.
 *
 * Three states, and they must not be collapsed into two: no target at all is a
 * real way to work ("characters go to your library"), while a target whose story
 * has since been deleted is a different fact — saying "no story selected" there
 * would be claiming a choice the writer never made.
 */
function targetLabel(recorded: string | null, title: string | null): string {
  if (!recorded) return 'no story selected';
  if (title) return `into ${title}`;
  return 'into a story since deleted';
}
