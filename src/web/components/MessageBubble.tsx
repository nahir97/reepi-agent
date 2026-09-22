/**
 * A single turn, as a chat bubble.
 *
 * Both sides share one shape — an avatar, a name line, a bubble — because that
 * is what makes a transcript skimmable: the eye finds the speaker before it
 * reads a word. The writer's turns align right and tint with the accent; the
 * story's turns align left on panel paper.
 *
 * What is deliberately *not* here: token counts, hit rates, cost, timing. All of
 * it still exists and is one click away under the turn's overflow, but a bubble
 * that advertises its own price is a bubble you cannot get lost in. The rule is
 * that the default view of a turn is the writing and nothing else.
 */

import { useState } from 'react';
import { countWords } from '../../shared/tokens.ts';
import { formatDuration, formatPercent } from '../../shared/cost.ts';
import type { Message } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { resolveSpeaker } from '../speakers.ts';
import { Avatar } from './Avatar.tsx';
import { Prose } from './Prose.tsx';
import { MessageActions } from './MessageActions.tsx';
import { IconChevronDown, IconClapper, IconQuote } from './icons.tsx';

export type MessageBubbleProps = {
  message: Message;
  streaming: boolean;
  /** Prose painted live by the stream rather than read from the row. */
  pendingText?: string;
  pendingReasoning?: string;
};

const ORIGIN_LABEL: Record<Message['origin'], string | null> = {
  user: null,
  narrator: null,
  continue: 'continued',
  impersonate: 'written as you',
  greeting: 'opening',
  rewrite: 'rewritten',
  conductor: 'conductor pick',
  expansion: 'expansion',
};

export function MessageBubble({ message, streaming, pendingText, pendingReasoning }: MessageBubbleProps) {
  const bundle = useStore((state) => state.bundle);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const live = pendingText !== undefined && pendingText.length > 0;
  const text = live ? pendingText : (message.variants[message.activeVariant] ?? '');
  const reasoning = (live ? pendingReasoning : message.reasoning[message.activeVariant]) ?? '';
  const usage = message.usage;
  const words = countWords(text);
  const originLabel = ORIGIN_LABEL[message.origin];
  const speaker = resolveSpeaker(bundle, message);

  const label =
    speaker.name === 'Narrator' && message.origin === 'conductor'
      ? 'Narrator · conductor'
      : speaker.name === 'Narrator' && message.origin === 'impersonate'
        ? 'You, impersonated'
        : speaker.name === 'Narrator' && message.origin === 'greeting'
          ? 'Opening'
          : speaker.name;

  /* ------------------------------------------------------------- the bubble */

  return (
    <article
      className={`group flex w-full gap-2.5 ${message.disabled ? 'opacity-45' : ''} ${
        speaker.mine ? 'flex-row-reverse' : ''
      }`}
      aria-label={`${label} turn`}
      data-message-id={message.id}
    >
      <Avatar name={label} src={speaker.avatar} size="md" className="mt-0.5" />

      <div className={`flex min-w-0 flex-col ${speaker.mine ? 'items-end' : 'items-start'} max-w-[min(100%,44rem)]`}>
        {/* Who is talking. Always present, so the avatar never has to be read. */}
        <div className={`mb-1 flex items-baseline gap-1.5 px-1 ${speaker.mine ? 'flex-row-reverse' : ''}`}>
          <span className="font-display text-[12.5px] font-semibold" style={{ color: speaker.mine ? 'var(--player)' : 'var(--text-dim)' }}>
            {label}
          </span>
          {originLabel && message.origin !== 'narrator' ? <span className="chip">{originLabel}</span> : null}
          {message.pinned ? <span className="chip chip-accent">in prefix</span> : null}
          {message.disabled ? <span className="chip">excluded</span> : null}
          {streaming ? <span className="chip chip-hit animate-pulse-soft">streaming</span> : null}
        </div>

        {/* Thinking is billed as output, so it stays folded away by default —
            but it is the model's own account of the turn, so it is never hidden
            outright. */}
        {reasoning.trim() ? (
          <div className={`mb-1 w-full px-1 ${speaker.mine ? 'text-right' : ''}`}>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[11px] text-faint transition-colors hover:text-dim"
              onClick={() => setDetailsOpen((value) => !value)}
              aria-expanded={detailsOpen}
            >
              <span className={`transition-transform duration-150 ${detailsOpen ? '' : '-rotate-90'}`}>
                <IconChevronDown size={11} />
              </span>
              <span className="eyebrow" style={{ letterSpacing: '0.1em' }}>
                thinking
              </span>
            </button>
            {detailsOpen ? (
              <pre
                className="prose-tight mt-1.5 max-h-72 overflow-auto rounded-md border border-border p-2.5 text-left whitespace-pre-wrap"
                style={{ background: 'var(--bg-sunken)' }}
              >
                {reasoning}
              </pre>
            ) : null}
          </div>
        ) : null}

        <div className={`bubble ${speaker.mine ? 'bubble-user' : 'bubble-narrator'}`}>
          {text.trim() || streaming ? (
            <Prose text={text} streaming={streaming} />
          ) : (
            <p className="prose-rp text-faint italic">Waiting for the first token…</p>
          )}
        </div>

        {/* Turn facts, folded. The row of chips that used to sit under every
            bubble lives here now. */}
        {usage || message.injections.length > 0 ? (
          <details className="mt-1 w-full px-1" onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
            <summary
              className={`flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-faint select-none ${
                speaker.mine ? 'justify-end' : ''
              }`}
            >
              <IconChevronDown size={10} />
              <span className="eyebrow">Turn details</span>
              {usage ? (
                <span className="num">
                  {formatPercent(
                    usage.cacheHitTokens + usage.cacheMissTokens > 0
                      ? usage.cacheHitTokens / (usage.cacheHitTokens + usage.cacheMissTokens)
                      : 0,
                  )}{' '}
                  cached
                </span>
              ) : null}
            </summary>

            <div className="mt-1.5 rounded-lg border border-border p-2.5" style={{ background: 'var(--bg-sunken)' }}>
              {usage ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  <Fact label="Cache hit" value={`${formatPercent(
                    usage.cacheHitTokens + usage.cacheMissTokens > 0
                      ? usage.cacheHitTokens / (usage.cacheHitTokens + usage.cacheMissTokens)
                      : 0,
                  )}`} />
                  <Fact label="Hit tokens" value={usage.cacheHitTokens.toLocaleString()} />
                  <Fact label="Miss tokens" value={usage.cacheMissTokens.toLocaleString()} />
                  <Fact label="Output" value={usage.outputTokens.toLocaleString()} />
                  <Fact label="Cost" value={`$${usage.costUsd.toFixed(6)}`} />
                  <Fact label="Saved vs cold" value={`$${usage.savedUsd.toFixed(6)}`} tone="var(--ok)" />
                  <Fact label="First token" value={usage.ttftMs === null ? '—' : formatDuration(usage.ttftMs)} />
                  <Fact label="Total" value={formatDuration(usage.totalMs)} />
                  <Fact label="Billed at" value={usage.peak ? 'peak 2×' : 'off-peak'} />
                  {usage.reasoningTokens > 0 ? (
                    <Fact label="Reasoning" value={usage.reasoningTokens.toLocaleString()} />
                  ) : null}
                  <Fact label="Words" value={words.toLocaleString()} />
                </dl>
              ) : (
                <p className="text-[11.5px] text-faint">{words} words · no usage recorded for this turn.</p>
              )}

              {message.injections.length > 0 ? (
                <div className="mt-2.5 border-t border-border pt-2">
                  <div className="mb-1 flex items-center gap-1.5">
                    <IconQuote size={11} className="text-faint" />
                    <span className="eyebrow">Lore injected ({message.injections.length})</span>
                  </div>
                  <ul className="space-y-1">
                    {message.injections.map((hit) => (
                      <li key={`${hit.entryId}-${hit.position}-${hit.depth}`} className="text-[11px] text-dim">
                        <span className="num text-accent">{hit.tokens}t</span>{' '}
                        <span className="font-medium">{hit.title}</span>{' '}
                        <span className="text-faint">
                          · {hit.position}
                          {hit.position === 'depth' ? `@${hit.depth}` : ''} · {hit.reason} · score{' '}
                          {hit.score.toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}

        {message.origin === 'conductor' ? (
          <p className={`mt-1 flex items-center gap-1.5 px-1 text-[11px] text-faint ${speaker.mine ? 'flex-row-reverse' : ''}`}>
            <IconClapper size={11} />
            Chosen from several candidates that shared one cached prefix.
          </p>
        ) : null}

        <div className={`mt-1 w-full px-1 ${speaker.mine ? 'flex justify-end' : ''}`}>
          <MessageActions message={message} text={text} />
        </div>
      </div>
    </article>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-0.5 text-[12px]" style={tone ? { color: tone } : undefined}>
        {value}
      </dd>
    </div>
  );
}
