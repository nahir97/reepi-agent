/**
 * One card in a roster, wherever the roster is.
 *
 * This was `CastPage`'s private markup, and it is now shared by three hosts: the
 * cast page (this story's payload and the whole library), the Discover launcher
 * (every character, one gesture from a conversation) and the Characters page
 * (characters and personas app-wide). Three copies of a card is exactly how two
 * hosts that should look identical stop matching — the same argument that made
 * `StudioNav` one list for the rail and the sheet.
 *
 * The shape encodes the one hard rule: **a card with a chat action cannot be a
 * single button**, because the pencil and the cast control would then be buttons
 * inside a button. So a card whose body opens a conversation is a `div` with an
 * explicit footer, and a card whose body opens its editor stays the one big
 * button it has always been.
 *
 * The pencil is dim rather than invisible. A control revealed on hover is a
 * control a touch device never finds.
 */

import type { ReactElement, ReactNode } from 'react';
import { formatTokens } from '../../shared/cost.ts';
import type { Character } from '../../shared/types.ts';
import { Avatar } from './Avatar.tsx';
import { IconPen, IconPlus, IconUsers } from './icons.tsx';

/**
 * The card's own tags, read out of the freeform `meta` blob.
 *
 * `Character.meta` has no schema any UI writes — it is where the card importer
 * parks everything Reepi has no column for. Tags are therefore read strictly and
 * defensively: anything that is not a non-empty string is dropped, and an
 * unparseable blob yields an empty list rather than a filter over nothing.
 */
export function characterTags(character: Character, limit = 4): string[] {
  const raw = character.meta['tags'];
  if (!Array.isArray(raw)) return [];
  const tags: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const tag = value.trim();
    if (!tag || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length >= limit) break;
  }
  return tags;
}

export type RosterCardProps = {
  kind: 'character' | 'persona';
  name: string;
  /** The one line under the name: a tagline, or a persona's description. */
  sub: string;
  avatar: string | null;
  tokens: number;
  /** `default`, `active`, `in 3 casts`, `no home story` — already worded by the host. */
  badges?: ReactNode;
  /** Chips under the tagline: tags, a chat, a cast count. */
  chips?: ReactNode;
  /** Non-null makes the card's body open a conversation instead of the editor. */
  onOpen: (() => void) | null;
  /**
   * A second start gesture, shown only when `onOpen` would *resume*: start a fresh
   * conversation even though one already exists. A card owns many chats, so
   * "the one I was in" and "a new one" are two different verbs.
   */
  onNewChat?: () => void;
  onEdit: () => void;
  /** A single trailing footer action: `Add to story`, `Remove`, `New chat`… */
  action?: ReactNode;
  /** Wording for the body's own footer action, when `onOpen` is a chat. */
  openLabel?: string;
  /** The glyph on that action. The cast page uses the roster icon; Discover a plus. */
  openIcon?: (props: { size?: number }) => ReactElement;
  openBlockedReason?: string;
};

export function RosterCard({
  kind,
  name,
  sub,
  avatar,
  tokens,
  badges,
  chips,
  onOpen,
  onNewChat,
  onEdit,
  action,
  openLabel = 'Chat',
  openIcon: OpenIcon = IconUsers,
  openBlockedReason,
}: RosterCardProps) {
  const blocked = Boolean(openBlockedReason);

  const body = (
    <>
      <div className="flex w-full items-start gap-2.5">
        <Avatar name={name} src={avatar} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[14px] leading-tight font-semibold">{name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            <span className={`chip ${kind === 'persona' ? 'chip-accent' : ''}`}>{kind}</span>
            {badges}
            {chips}
          </span>
        </span>
        {onOpen ? null : (
          <span className="shrink-0 text-faint">
            <IconPen size={12} />
          </span>
        )}
      </div>

      <p className="min-h-[2.2em] flex-1 text-[11.5px] leading-snug text-dim">{sub}</p>
    </>
  );

  const weight = <span className="num text-[10.5px] text-faint">{formatTokens(tokens)} tok</span>;

  if (!onOpen) {
    return (
      <button
        type="button"
        className="card group flex h-full w-full flex-col gap-2.5 p-3 text-left transition-colors hover:border-[var(--border-strong)]"
        style={{ background: 'var(--panel-raised)' }}
        onClick={onEdit}
        aria-label={`Edit ${name}`}
      >
        {body}
        <span className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-2">
          {weight}
          {action ? <span className="ml-auto">{action}</span> : null}
          <span className={`${action ? '' : 'ml-auto'} text-[11px] font-medium text-accent`}>Edit</span>
        </span>
      </button>
    );
  }

  return (
    <div
      className="card flex h-full w-full flex-col gap-2.5 p-3 transition-colors hover:border-[var(--border-strong)]"
      style={{ background: 'var(--panel-raised)' }}
      /* The reason is carried by the card, not only by the disabled control: a
         disabled button does not raise a tooltip in every browser, so the card
         would silently stop explaining itself. */
      title={openBlockedReason}
    >
      {/* The body opens the conversation itself, which is the large obvious hit
          target; the labelled control below it is the one that says what it does.
          Both are blocked together — a card whose chat cannot be reached must not
          open one from its face either. */}
      <button
        type="button"
        className="flex flex-col gap-2.5 text-left"
        onClick={onOpen}
        disabled={blocked}
        title={openBlockedReason}
        aria-label={`Open ${name}`}
      >
        {body}
      </button>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        {weight}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {action}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.25rem 0.5rem' }}
            onClick={onOpen}
            disabled={blocked}
            title={openBlockedReason}
            aria-label={blocked ? openBlockedReason : `${openLabel} with ${name}`}
          >
            <OpenIcon size={11} />
            {openLabel}
          </button>
          {onNewChat ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0.25rem 0.5rem' }}
              onClick={onNewChat}
              title={`Start a new chat with ${name}`}
              aria-label={`Start a new chat with ${name}`}
            >
              <IconPlus size={11} />
              New
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn shrink-0 opacity-60 transition-opacity hover:opacity-100"
            style={{ width: 24, height: 24 }}
            onClick={onEdit}
            aria-label={`Edit ${name}`}
            title={`Edit ${name}`}
          >
            <IconPen size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
