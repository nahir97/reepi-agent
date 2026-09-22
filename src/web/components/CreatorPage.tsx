/**
 * The Creation assistant: a page for asking the studio to build world material.
 *
 * It is a *page* for the same reason the cast roster is one. A request box, the
 * log of what came back, and the receipt of every write need the column; a dialog
 * over the prose would hide the thing you are building a world for, and the cast
 * page already established that a sustained building surface gets the window.
 *
 * What the page shows, and why each part is here:
 *
 * - **The request box first**, because that is the whole interaction. Quick-start
 *   chips exist because "what can it do" is otherwise a guess — they name the five
 *   things this pass is genuinely good at, in the writer's language.
 * - **The rewrite consent**, as a labelled checkbox rather than a hidden default.
 *   Replacing a block that already has text re-prices the cache prefix from that
 *   block onward, and the writer's own prose is not something a model gets to
 *   overwrite quietly. Off is the default; the receipt says which way it was set.
 * - **The receipt per turn**, because a turn can write a dozen rows. Names, token
 *   weights, revisions, refusals and any replaced block are all stated in words.
 * - **The prefix movement**, read from the server's own plan — not from the model's
 *   summary. A write that added cards or rewrote a block moved the frozen prefix,
 *   and the one useful number afterwards is which blocks moved. Warming is one
 *   deliberate press away, because that is exactly what it is for.
 *
 * The log is the session's, not the studio's: a reload loses this conversation and
 * keeps every row it wrote, which are visible in the cast page, the inspector and
 * the template dialog.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTokens, formatUsd } from '../../shared/cost.ts';
import { useStore, type CreatorTurn } from '../store.ts';
import { PageBand } from './panel.tsx';
import { IconAlert, IconCheck, IconPlus, IconTrash, IconWand } from './icons.tsx';

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
 * it is not a new card, it is an existing one now in this story's payload.
 */
const KIND_LABEL: Record<string, string> = {
  story: 'story',
  character: 'character',
  lore: 'lore entry',
  template: 'template',
  cast: 'added to cast',
};

type Starter = { label: string; request: string; needsStory: boolean };

/** The five things this pass is for, phrased as the ask rather than as a feature. */
const STARTERS: Starter[] = [
  {
    label: 'Cast a character',
    request:
      'Write one character who belongs in this story: a name, a tagline, who they are, how they behave, and how they speak.',
    needsStory: true,
  },
  {
    label: 'File a lorebook',
    request:
      'File a lorebook of four entries about this world: the most important place, faction, custom and piece of history. Give each one trigger keys so it fires when it matters.',
    needsStory: true,
  },
  {
    label: 'Write the scenario',
    request: 'Write the scenario block: the situation this story opens into, in a short paragraph.',
    needsStory: true,
  },
  {
    label: 'Write the story bible',
    request:
      'Write the story bible: the world’s facts, places, rules and history, as a set of short declarative lines the narrator can act on.',
    needsStory: true,
  },
  {
    label: 'Draft a prompt template',
    request:
      'Draft a reusable prompt template for tight, concrete prose — a style block a writer could apply to any story.',
    needsStory: false,
  },
  {
    label: 'Start a story from a pitch',
    request: 'Start a new story from this pitch: ',
    needsStory: false,
  },
];

export function CreatorPage() {
  const bundle = useStore((state) => state.bundle);
  const creator = useStore((state) => state.creator);
  const runCreator = useStore((state) => state.runCreator);
  const clearCreatorLog = useStore((state) => state.clearCreatorLog);
  const setPage = useStore((state) => state.setPage);
  const plan = useStore((state) => state.plan);
  const busy = useStore((state) => state.busy);
  const runWarm = useStore((state) => state.runWarm);
  const openStory = useStore((state) => state.openStory);

  const [text, setText] = useState('');
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const input = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const story = bundle?.story ?? null;
  const sessionCost = useMemo(() => creator.log.reduce((sum, turn) => sum + turn.costUsd, 0), [creator.log]);
  const starters = useMemo(
    () => STARTERS.filter((starter) => starter.needsStory === false || story !== null),
    [story],
  );

  /* What the server's own plan says moved. Not a prediction: the same readout the
     payload rail shows, filtered to the blocks that changed since the last turn
     that received a cache hit.

     `previousHitRate === null` means no narration turn has landed in this story
     yet, and the composer marks *every* block changed against a payload that never
     existed. Saying "the prefix moved" there would be a lie about a cache that was
     never warm, so the strip stays away until there is something to have lost. */
  const hasBaseline = plan !== null && plan.previousHitRate !== null;
  const moved = useMemo(
    () => (hasBaseline ? plan.blocks.filter((block) => block.changed) : []),
    [plan, hasBaseline],
  );

  const submit = async (): Promise<void> => {
    const request = text.trim();
    if (!request || creator.busy) return;
    await runCreator({ text: request, allowOverwrite });
    /* Keep the ask if the turn failed, so the writer can fix and re-send it. */
    if (!useStore.getState().creator.error) setText('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <PageBand
        onBack={() => setPage('story')}
        title="Creation assistant"
        hint={
          creator.log.length > 0
            ? `${creator.log.length} turn${creator.log.length === 1 ? '' : 's'} · ${formatUsd(sessionCost)} this session`
            : story
              ? `writing into ${story.title}`
              : 'no story open — templates and new stories'
        }
        actions={
          creator.log.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0.3rem 0.55rem' }}
              onClick={clearCreatorLog}
              title="Clear this session's log. Nothing it wrote is deleted."
            >
              <IconTrash size={11} />
              Clear log
            </button>
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[52rem] px-4 py-4">
          {/* ------------------------------------------------------- the ask */}

          <div className="card p-3" style={{ background: 'var(--panel-raised)' }}>
            <label className="eyebrow" htmlFor="creator-request">
              What should the studio build?
            </label>
            <textarea
              id="creator-request"
              ref={input}
              className="field mt-1.5 font-serif"
              rows={3}
              value={text}
              placeholder={
                story
                  ? 'Four lore entries about the drowned archive, and a steward who guards it.'
                  : 'A noir story about a courier carrying a treaty that will be obsolete on arrival.'
              }
              aria-describedby="creator-hint"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                /* Enter sends; Shift+Enter is a newline. The compose box works the
                   same way, so the muscle memory carries. */
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
                disabled={creator.busy || text.trim().length === 0}
                onClick={() => void submit()}
              >
                <IconWand size={12} />
                {creator.busy ? 'Building…' : 'Build it'}
              </button>

              <label
                className="flex min-w-0 items-center gap-2 text-[11.5px] text-dim"
                title="Off by default. With it on, the assistant may replace a directive block that already has your text."
              >
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={allowOverwrite}
                  onChange={(event) => setAllowOverwrite(event.target.checked)}
                />
                Allow rewriting blocks that already have text
              </label>
            </div>

            <p id="creator-hint" className="mt-2 text-[10.5px] leading-snug text-faint">
              Runs as its own side-channel call, so it never touches the narration payload. What it writes
              does: a new card or a rewritten block re-prices the prefix from there on, and the plan below
              says which blocks moved.
            </p>

            {!story ? (
              <p className="mt-2 text-[11px] leading-snug" style={{ color: 'var(--warn)' }}>
                <IconAlert size={11} /> No story is open. It can still draft a prompt template or start a new
                story — open a story to build its cast, lore and blocks.
              </p>
            ) : null}
          </div>

          {/* ---------------------------------------------------- starters */}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {starters.map((starter) => (
              <button
                key={starter.label}
                type="button"
                className="chip"
                onClick={() => {
                  setText(starter.request);
                  input.current?.focus();
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

          {/* ---------------------------------------------------------- log */}

          {creator.error ? (
            <p className="mt-3 text-[12px] leading-snug" style={{ color: 'var(--danger)' }} role="alert">
              {creator.error}
            </p>
          ) : null}

          {creator.log.length === 0 && !creator.busy ? (
            <div className="mt-4 text-[12.5px] leading-relaxed text-dim">
              <p className="max-w-[62ch]">
                It writes the scaffolding, not the prose: character cards, lorebook entries, the story’s
                scenario and bible, and reusable prompt templates. It can also start a whole story from a
                pitch. It never writes dialogue, and it never writes your persona.
              </p>
              <p className="mt-2 max-w-[62ch] text-faint">
                Each turn is one side-channel call carrying the story’s own context — its blocks, its cast and
                its lore — so it writes in the world you already have rather than a generic one.
              </p>
            </div>
          ) : null}

          <ol className="mt-4 space-y-4" aria-busy={creator.busy}>
            {creator.log.map((turn) => (
              <li key={turn.id}>
                <Turn turn={turn} onOpenStory={(storyId) => void openStory(storyId)} />
              </li>
            ))}
          </ol>

          {creator.busy ? (
            <p className="mt-3 flex items-center gap-2 text-[12px] text-faint" role="status">
              <span className="animate-pulse-soft" style={{ color: 'var(--accent)' }}>
                <IconWand size={13} />
              </span>
              Reading the world and writing into it…
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- receipt */

function Turn({ turn, onOpenStory }: { turn: CreatorTurn; onOpenStory: (storyId: string) => void }) {
  const created = turn.created;
  return (
    <article>
      <div className="flex items-start gap-2">
        <span className="eyebrow mt-1 shrink-0">You</span>
        <p className="min-w-0 flex-1 font-serif text-[13px] leading-snug whitespace-pre-wrap">{turn.request}</p>
        <span className="num shrink-0 text-[10px] text-faint">{formatUsd(turn.costUsd)}</span>
      </div>

      {turn.reply ? (
        <p className="mt-2 ml-8 font-serif text-[13.5px] leading-relaxed">{turn.reply}</p>
      ) : null}

      {created.length > 0 || turn.updated.length > 0 || turn.refused.length > 0 || turn.replacedBlocks.length > 0 ? (
        <div className="card mt-2 ml-8 p-2.5" style={{ background: 'var(--panel-raised)' }}>
          {created.length > 0 ? (
            <ul className="space-y-1">
              {created.map((row) => (
                <li key={`${row.kind}-${row.id}`} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                  <span className="chip chip-hit">
                    <IconCheck size={10} />
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {row.tokens !== undefined ? (
                    <span className="num shrink-0 text-[10.5px] text-faint">{formatTokens(row.tokens)} tok</span>
                  ) : null}
                  {row.kind === 'story' ? (
                    <button type="button" className="btn btn-ghost" style={{ padding: '0.2rem 0.45rem' }} onClick={() => onOpenStory(row.id)}>
                      Open it
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {turn.updated.length > 0 ? (
            <ul className={`space-y-1 ${created.length > 0 ? 'mt-1.5' : ''}`}>
              {turn.updated.map((row, index) => (
                <li key={`${row.kind}-${row.name}-${index}`} className="flex flex-wrap items-center gap-2 text-[11.5px]">
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

          {turn.replacedBlocks.length > 0 ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug" style={{ color: 'var(--warn)' }}>
              <IconAlert size={11} />
              <span>
                Replaced {turn.replacedBlocks.map((block) => BLOCK_LABEL[block] ?? block).join(', ')} — the
                prefix behind {turn.replacedBlocks.length === 1 ? 'it' : 'them'} is re-priced next turn.
              </span>
            </p>
          ) : null}

          {turn.refused.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {turn.refused.map((row, index) => (
                <li key={`${row.target}-${index}`} className="text-[11px] leading-snug" style={{ color: 'var(--danger)' }}>
                  {row.target}: {row.reason}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="num mt-1.5 text-[10px] text-faint">
            {turn.allowOverwrite ? 'rewriting was enabled for this turn' : 'rewriting was off for this turn'}
          </p>
        </div>
      ) : null}
    </article>
  );
}

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
