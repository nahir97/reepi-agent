/**
 * The Creation assistant: a conversation that builds the studio's content.
 *
 * It is app-scoped, and that is the design, not a detail. The assistant is not a
 * story: its chat is its own (persisted, reloadable), it is reachable before any
 * story exists, and the story a turn may write into is something the writer points
 * it at. Nothing here reads `activeStoryId` — a turn that wrote into "whatever was
 * open" could land in a world the writer was not looking at.
 *
 * What the page shows, and why each part is here:
 *
 * - **The conversation**, read back from the server, receipts included. A receipt
 *   read a week later has to say what that turn did *and* what it was allowed to
 *   do, which is why it is stored rather than re-derived from the current state.
 * - **The target picker**, one labelled control: no story, or one story. "No
 *   story" is a real way to work — characters become library cards with no home,
 *   templates are app-wide, and a whole story can be created by the turn.
 * - **The rewrite consent**, off by default, because replacing a block that
 *   already has text re-prices the cache prefix from there on and the writer's own
 *   prose is not something a model gets to overwrite quietly.
 * - **The prefix movement**, read from the server's own plan: after a write, the
 *   one number that matters is which frozen blocks moved.
 *
 * Stopping is honest: a stopped turn records nothing and writes nothing, so the
 * ask stays in the box for the writer to finish or re-send.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTokens, formatUsd } from '../../shared/cost.ts';
import type { CreatorMessage } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { PageBand } from './panel.tsx';
import { IconAlert, IconCheck, IconPlus, IconStop, IconTrash, IconWand } from './icons.tsx';

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
  const box = useRef<HTMLTextAreaElement | null>(null);
  const thread = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadCreatorThread();
  }, [loadCreatorThread]);

  useEffect(() => {
    box.current?.focus();
  }, []);

  /* Keep the newest turn in view as the conversation grows. */
  useEffect(() => {
    const node = thread.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [creator.thread.length, creator.pending]);

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
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <PageBand
        onBack={() => setPage('story')}
        title="Creation assistant"
        hint={
          creator.thread.length > 0
            ? `${Math.ceil(creator.thread.length / 2)} turn${creator.thread.length > 2 ? 's' : ''} · ${formatUsd(
                threadCost,
              )} · ${target ? `writing into ${target.title}` : 'no story selected'}`
            : target
              ? `writing into ${target.title}`
              : 'no story selected — characters become library cards'
        }
        actions={
          <>
            {asking ? (
              <button type="button" className="btn" style={{ padding: '0.3rem 0.55rem' }} onClick={stopCreator}>
                <IconStop size={11} />
                Stop
              </button>
            ) : null}
            {creator.thread.length > 0 && !asking ? (
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
            ) : null}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[52rem] flex-col px-4 py-4">
          {/* -------------------------------------------------------- the ask */}

          <div className="card p-3" style={{ background: 'var(--panel-raised)' }}>
            <label className="label" htmlFor="creator-target">
              Write into
            </label>
            <select
              id="creator-target"
              className="field field-sm"
              value={creator.targetStoryId ?? ''}
              onChange={(event) => setCreatorTarget(event.target.value || null)}
              disabled={asking}
            >
              <option value="">No story — characters go to your library</option>
              {stories.map((story) => (
                <option key={story.id} value={story.id}>
                  {story.title}
                  {story.characterId ? ' (chat)' : ''}
                </option>
              ))}
            </select>

            <label className="eyebrow mt-3 block" htmlFor="creator-request">
              What should it build?
            </label>
            <textarea
              id="creator-request"
              ref={box}
              className="field mt-1.5 font-serif"
              rows={3}
              value={text}
              disabled={asking}
              placeholder={
                target
                  ? 'Four lore entries about the drowned archive, and a steward who guards it.'
                  : 'Three characters for a rain-soaked port city, each with something to hide.'
              }
              aria-describedby="creator-hint"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={asking || text.trim().length === 0}
                onClick={() => void submit()}
              >
                <IconWand size={12} />
                {asking ? 'Building…' : 'Build it'}
              </button>

              <label
                className="flex min-w-0 items-center gap-2 text-[11.5px] text-dim"
                title="Off by default. With it on, the assistant may replace a directive block that already has your text."
              >
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={allowOverwrite}
                  disabled={asking}
                  onChange={(event) => setAllowOverwrite(event.target.checked)}
                />
                Allow rewriting blocks that already have text
              </label>
            </div>

            <p id="creator-hint" className="mt-2 text-[10.5px] leading-snug text-faint">
              Runs as its own side-channel call, so it never touches the narration payload. What it writes
              does: a new card or a rewritten block re-prices the prefix from there on, and the plan below says
              which blocks moved.
            </p>
          </div>

          {/* ---------------------------------------------------- starters */}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {starters.map((starter) => (
              <button
                key={starter.label}
                type="button"
                className="chip"
                disabled={asking}
                onClick={() => {
                  setText(starter.request);
                  box.current?.focus();
                }}
              >
                <IconPlus size={10} />
                {starter.label}
              </button>
            ))}
          </div>

          {/* ------------------------------------------------ prefix movement */}

          {moved.length > 0 ? (
            <div className="card mt-3 p-2.5" style={{ background: 'var(--panel-raised)' }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow" style={{ color: 'var(--warn)' }}>
                  Prefix moved
                </span>
                <span className="text-[11.5px] text-dim">
                  {moved.length} block{moved.length === 1 ? '' : 's'} changed since the last cached turn:
                </span>
                <span className="num text-[11px] text-faint">
                  {moved.map((block) => `${block.label} (${formatTokens(block.tokens)} tok)`).join(' · ')}
                </span>
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
            </div>
          ) : null}

          {creator.error ? (
            <p className="mt-3 text-[12px] leading-snug" style={{ color: 'var(--danger)' }} role="alert">
              {creator.error}
            </p>
          ) : null}

          {/* ---------------------------------------------------------- chat */}

          <div className="mt-4 space-y-4" aria-busy={asking}>
            {creator.loaded && creator.thread.length === 0 && !asking ? (
              <div className="text-[12.5px] leading-relaxed text-dim">
                <p className="max-w-[62ch]">
                  It writes the scaffolding, not the prose: character cards, lorebook entries, the story’s
                  scenario and bible, and reusable prompt templates. It can also start a whole story from a
                  pitch. It never writes dialogue, and it never writes your persona.
                </p>
                <p className="mt-2 max-w-[62ch] text-faint">
                  Pick a story above to build inside one — or leave it on <em>No story</em> and it will write
                  characters into your library and make a world when you ask for one.
                </p>
              </div>
            ) : null}

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

            {creator.pending !== null ? (
              <div className="flex items-start gap-2 opacity-70">
                <span className="eyebrow mt-1 shrink-0">You</span>
                <p className="min-w-0 flex-1 font-serif text-[13px] leading-snug whitespace-pre-wrap">
                  {creator.pending}
                </p>
              </div>
            ) : null}

            {asking ? (
              <p className="flex items-center gap-2 text-[12px] text-faint" role="status">
                <span className="animate-pulse-soft" style={{ color: 'var(--accent)' }}>
                  <IconWand size={13} />
                </span>
                Reading the world and writing into it…
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- one message */

function Message({
  message,
  targetTitle,
  onOpenStory,
}: {
  message: CreatorMessage;
  targetTitle: string | null;
  onOpenStory: (storyId: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <article className="flex items-start gap-2">
        <span className="eyebrow mt-1 shrink-0">You</span>
        <p className="min-w-0 flex-1 font-serif text-[13px] leading-snug whitespace-pre-wrap">{message.body}</p>
        <span className="num shrink-0 text-[10px] text-faint" title={targetTitle ?? 'no story selected'}>
          {targetTitle ?? 'library'}
        </span>
      </article>
    );
  }

  const receipt = message.receipt;
  return (
    <article>
      <div className="flex items-start gap-2">
        <span className="eyebrow mt-1 shrink-0">It</span>
        <p className="min-w-0 flex-1 font-serif text-[13.5px] leading-relaxed">{message.body}</p>
        {receipt ? <span className="num shrink-0 text-[10px] text-faint">{formatUsd(receipt.costUsd)}</span> : null}
      </div>

      {receipt &&
      (receipt.created.length > 0 ||
        receipt.updated.length > 0 ||
        receipt.refused.length > 0 ||
        receipt.replacedBlocks.length > 0) ? (
        <div className="card mt-2 ml-8 p-2.5" style={{ background: 'var(--panel-raised)' }}>
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
                    <span className="num shrink-0 text-[10.5px] text-faint">
                      {row.fields.map((field) => FIELD_LABEL[field] ?? field).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {receipt.replacedBlocks.length > 0 ? (
            <p
              className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug"
              style={{ color: 'var(--warn)' }}
            >
              <IconAlert size={11} />
              <span>
                Replaced {receipt.replacedBlocks.map((block) => BLOCK_LABEL[block] ?? block).join(', ')} — the
                prefix behind {receipt.replacedBlocks.length === 1 ? 'it' : 'them'} is re-priced next turn.
              </span>
            </p>
          ) : null}

          {receipt.refused.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {receipt.refused.map((row, index) => (
                <li
                  key={`${row.target}-${index}`}
                  className="text-[11px] leading-snug"
                  style={{ color: 'var(--danger)' }}
                >
                  {row.target}: {row.reason}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="num mt-1.5 text-[10px] text-faint">
            {message.targetStoryId ? `into ${targetTitle ?? 'a deleted story'}` : 'no story selected'} ·{' '}
            {message.allowOverwrite ? 'rewriting enabled' : 'rewriting off'}
          </p>
        </div>
      ) : null}
    </article>
  );
}
