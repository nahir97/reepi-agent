/**
 * The cast page: the roster, and the way into a conversation with one of them.
 *
 * This is a *page*, not a dialog, and that is the whole decision. A roster is
 * browsed — you scan it, you compare cards, you come back to it after opening
 * one — and a 54rem frame floating over the prose is the wrong shape for
 * scanning. Pages also stay put: a card opened from here closes back to a page
 * that never went away, where the modal version needed a `from` field on the
 * dialog, the card and the confirm prompt just to fake the same thing.
 *
 * What a card's click *does* is the other half of that decision, and it changed:
 * a character card now opens the 1:1 chat with that character — starting it the
 * first time — because talking to someone is why the card exists. Editing is the
 * pencil in the card's footer, one deliberate action rather than the only action.
 * A persona card is unchanged: a persona is the writer's own mask, not someone to
 * talk to, so its whole card still opens its editor.
 *
 * What it shows, and why:
 *
 * - **Characters and personas as one roster**, filterable, because "who is in
 *   this story, and who am I" is one question even though it is two tables.
 * - **The token count on every card**, because these cards sit in the frozen
 *   prefix: a 400-token card is a permanent 400 tokens on every request, and
 *   that is the one number here a writer acts on. It comes from the bundle the
 *   server computed, never from a client estimate.
 * - **No tags, no favourites, no creator fields.** Characters imported from a
 *   card carry tags inside `meta`, but `meta` is a freeform blob with no schema
 *   any UI writes; a filter over it would be a filter over nothing. Grouping is
 *   by the two kinds that actually exist.
 *
 * Inside a chat the roster is the one borrowed card plus the persona pool, so the
 * character card there is edit-only (you are already in its conversation) and the
 * add-character button is gone: a chat has exactly one character, by definition.
 *
 * The prose stays one row below this in the App: the composer is hidden while a
 * page is up, because a page is not a place to write.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { formatTokens } from '../../shared/cost.ts';
import type { Character, Persona, Story } from '../../shared/types.ts';
import { useStore, type CardKind } from '../store.ts';
import { Avatar } from './Avatar.tsx';
import { IconChevronLeft, IconPen, IconPlus, IconSearch, IconUser, IconUsers } from './icons.tsx';

/* ------------------------------------------------------------------- model */

/**
 * One roster entry, whichever table it came from. The two entities genuinely
 * differ — a character has a tagline and can have a chat, a persona has an active
 * flag and cannot — so the shared shape carries only what both have, and `sub` is
 * the line each one supplies for itself.
 */
type RosterEntry = {
  id: string;
  kind: CardKind;
  name: string;
  sub: string;
  avatar: string | null;
  tokens: number;
  updatedAt: number;
  /** `default`, `active` — a property only one of the two kinds can have. */
  badge?: string;
  /** The conversation started from this card, if there is one. Characters only. */
  chat: Story | null;
};

type SortKey = 'recent' | 'name' | 'tokens';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'recent', label: 'Recently updated' },
  { id: 'name', label: 'Name' },
  { id: 'tokens', label: 'Weight in the payload' },
];

function entriesOf(
  characters: Character[],
  personas: Persona[],
  personaId: string | null,
  chats: Story[],
  inChat: boolean,
): RosterEntry[] {
  const chatOf = new Map(chats.map((chat) => [chat.characterId ?? '', chat]));
  return [
    ...characters.map(
      (character): RosterEntry => ({
        id: character.id,
        kind: 'character',
        name: character.name,
        sub: character.tagline || 'no tagline yet',
        avatar: character.avatar,
        tokens: character.tokens,
        updatedAt: character.updatedAt,
        /* Inside a chat the card *is* that chat, so "has a chat" would be a chip
           stating the obvious. It is a fact about the roster outside one. */
        chat: inChat ? null : (chatOf.get(character.id) ?? null),
      }),
    ),
    ...personas.map(
      (persona): RosterEntry => ({
        id: persona.id,
        kind: 'persona',
        name: persona.name,
        sub: persona.description ? firstLine(persona.description) : 'no description yet',
        avatar: persona.avatar,
        tokens: persona.tokens,
        updatedAt: persona.updatedAt,
        chat: null,
        ...(persona.id === personaId ? { badge: 'active' } : persona.isDefault ? { badge: 'default' } : {}),
      }),
    ),
  ];
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 96 ? `${line.slice(0, 96)}…` : line;
}

/* -------------------------------------------------------------------- page */

export function CastPage() {
  const bundle = useStore((state) => state.bundle);
  const stories = useStore((state) => state.stories);
  const setPage = useStore((state) => state.setPage);
  const createCard = useStore((state) => state.createCard);
  const startChatWith = useStore((state) => state.startChatWith);
  const openDialog = useStore((state) => state.openDialog);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | CardKind>('all');
  const [sort, setSort] = useState<SortKey>('recent');

  const characters = bundle?.characters ?? [];
  const personas = bundle?.personas ?? [];
  const personaId = bundle?.story.personaId ?? null;
  /* A chat is a story with `characterId` set, so "does this card have a chat" is
     a question the library already answers — no extra endpoint, no extra field. */
  const chats = useMemo(() => stories.filter((story) => story.characterId !== null), [stories]);
  const isChat = Boolean(bundle?.story.characterId);

  const roster = useMemo(
    () => entriesOf(characters, personas, personaId, chats, isChat),
    [characters, personas, personaId, chats, isChat],
  );

  /* Search matches the name and the line under it. `sub` is included because a
     writer looks for "the steward" as often by what the card says as by what it
     is called. */
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = roster.filter(
      (entry) =>
        (kind === 'all' || entry.kind === kind) &&
        (needle === '' || `${entry.name} ${entry.sub}`.toLowerCase().includes(needle)),
    );
    const sorted = [...filtered];
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'tokens') sorted.sort((a, b) => b.tokens - a.tokens);
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }, [roster, query, kind, sort]);

  /* Grouped only when nothing narrower has been asked for. A filter is a request
     for one list; headings on top of it would re-impose the split the writer just
     filtered away.
     
     The consequence is that the sort orders *within* each group, not across the
     whole roster: choosing "Weight in the payload" gives the heaviest character
     followed by the heaviest persona, not one global ranking. That is deliberate
     and it is legible, because the headings that cause it are on screen — a
     writer who wants one global order filters to one kind first. */
  const groups = useMemo(() => {
    if (kind !== 'all') return [{ key: kind, label: null as string | null, items: matched }];
    return [
      { key: 'character' as const, label: 'Characters', items: matched.filter((entry) => entry.kind === 'character') },
      { key: 'persona' as const, label: 'Personas', items: matched.filter((entry) => entry.kind === 'persona') },
    ].filter((group) => group.items.length > 0);
  }, [matched, kind]);

  const totalTokens = roster.reduce((sum, entry) => sum + entry.tokens, 0);

  if (!bundle) {
    return (
      <div className="flex h-full flex-col">
        <Band onBack={() => setPage('story')} title="Cast" />
        <p className="px-4 py-6 text-[12.5px] text-faint">Open a story first — a cast belongs to one.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <Band
        onBack={() => setPage('story')}
        title={isChat ? `Cast of ${bundle.story.title}` : 'Cast'}
        hint={`${roster.length} card${roster.length === 1 ? '' : 's'} · ${formatTokens(totalTokens)} tokens in the prefix`}
        actions={
          <>
            <button type="button" className="btn" style={{ padding: '0.35rem 0.6rem' }} onClick={() => void createCard('persona')}>
              <IconUser size={12} />
              Persona
            </button>
            {/* A chat has exactly one character by construction, so there is
                nothing to add here — the button would create a row the composer
                never reads. */}
            {isChat ? null : (
              <button type="button" className="btn btn-primary" style={{ padding: '0.35rem 0.6rem' }} onClick={() => void createCard('character')}>
                <IconPlus size={12} />
                Character
              </button>
            )}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[64rem] px-4 py-4">
          {/* ------------------------------------------------------- controls */}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[13rem] flex-1">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">
                <IconSearch size={13} />
              </span>
              <label className="sr-only" htmlFor="cast-search">
                Search the cast
              </label>
              <input
                id="cast-search"
                className="field field-sm pl-7"
                type="search"
                value={query}
                placeholder="Search by name, or by what the card says"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            {/* Filtering is a segmented control rather than a select: three fixed
                options, and seeing them is how the writer learns personas and
                characters share this page. */}
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5" role="group" aria-label="Filter the cast">
              {(['all', 'character', 'persona'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="rounded-sm px-2 py-1 text-[11.5px] font-medium transition-colors"
                  style={{
                    background: kind === option ? 'var(--accent-soft)' : 'transparent',
                    color: kind === option ? 'var(--accent)' : 'var(--text-faint)',
                  }}
                  aria-pressed={kind === option}
                  onClick={() => setKind(option)}
                >
                  {option === 'all' ? 'All' : option === 'character' ? 'Characters' : 'Personas'}
                </button>
              ))}
            </div>

            <label className="sr-only" htmlFor="cast-sort">
              Sort the cast
            </label>
            <select
              id="cast-sort"
              className="field field-sm w-auto"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
            >
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* ------------------------------------------------------- the roster */}

          {matched.length === 0 ? (
            <p className="mt-5 text-[12.5px] leading-snug text-faint">
              {isChat && characters.length === 0
                ? 'The card this chat was started from is gone, so there is nothing to show here. The conversation is still yours.'
                : roster.length === 0
                  ? 'No one in this story yet. Add a character, or write a persona for yourself — both sit at the front of every request.'
                  : `Nothing matches ${query.trim() ? `“${query.trim()}”` : 'that filter'}.`}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="mt-5">
                {group.label ? (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="eyebrow">{group.label}</span>
                    <span className="num text-[10px] text-faint">{group.items.length}</span>
                  </div>
                ) : null}
                <ul className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}>
                  {group.items.map((entry) => (
                    <li key={`${entry.kind}-${entry.id}`}>
                      <RosterCard
                        entry={entry}
                        onEdit={() => openDialog({ kind: 'card', card: entry.kind, id: entry.id })}
                        /* Characters outside their own chat get the chat action.
                           Personas never do — they are the writer's mask, not
                           someone to talk to — and inside a chat you are already in
                           the conversation that card would open. */
                        onChat={
                          entry.kind === 'character' && !isChat
                            ? () => void startChatWith(entry.id)
                            : null
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- chrome */

/**
 * The page's band. `.topbar`, like every other column's header, so the rule under
 * it lines up with the library rail's and the payload rail's across the window.
 */
function Band({
  title,
  hint,
  onBack,
  actions,
}: {
  title: string;
  hint?: string;
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar pt-safe shrink-0 gap-2 border-b border-border px-3" style={{ background: 'var(--panel)' }}>
      {/* The way out, and it is the *only* way out — which is why the page is a
          full surface rather than an overlay: a page with a back control needs no
          second close. */}
      <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to the story">
        <IconChevronLeft size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-[15px] leading-tight font-semibold">{title}</h1>
        {hint ? <p className="num truncate text-[10.5px] text-faint">{hint}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

/* -------------------------------------------------------------- roster card */

/**
 * Two card shapes, one visual language.
 *
 * With a chat action the card cannot be a single button — the pencil inside it
 * would be a button inside a button — so the top half is the button that opens
 * the conversation and the footer holds the two explicit controls. Without one (a
 * persona, or a character inside its own chat) the whole card stays the single
 * button it has always been, because opening the editor is the only thing it can
 * do.
 *
 * The pencil is dim rather than invisible. A control revealed on hover is a
 * control a touch device never finds — the same trap the story rows were fixed
 * for.
 */
function RosterCard({
  entry,
  onChat,
  onEdit,
}: {
  entry: RosterEntry;
  onChat: (() => void) | null;
  onEdit: () => void;
}) {
  const body = (
    <>
      <div className="flex w-full items-start gap-2.5">
        <Avatar name={entry.name} src={entry.avatar} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[14px] leading-tight font-semibold">{entry.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            <span className={`chip ${entry.kind === 'persona' ? 'chip-accent' : ''}`}>
              {entry.kind === 'persona' ? 'persona' : 'character'}
            </span>
            {entry.badge ? <span className="chip chip-hit">{entry.badge}</span> : null}
            {entry.chat ? <span className="chip">in a chat</span> : null}
          </span>
        </span>
        {onChat ? null : (
          <span className="shrink-0 text-faint">
            <IconPen size={12} />
          </span>
        )}
      </div>

      <p className="min-h-[2.2em] flex-1 text-[11.5px] leading-snug text-dim">{entry.sub}</p>
    </>
  );

  if (!onChat) {
    return (
      <button
        type="button"
        className="card group flex h-full w-full flex-col gap-2.5 p-3 text-left transition-colors hover:border-[var(--border-strong)]"
        style={{ background: 'var(--panel-raised)' }}
        onClick={onEdit}
      >
        {body}
        <span className="flex w-full items-center gap-2 border-t border-border pt-2">
          <span className="num text-[10.5px] text-faint">{formatTokens(entry.tokens)} tok</span>
          <span className="ml-auto text-[11px] font-medium text-accent">Edit</span>
        </span>
      </button>
    );
  }

  return (
    <div
      className="card flex h-full w-full flex-col gap-2.5 p-3 transition-colors hover:border-[var(--border-strong)]"
      style={{ background: 'var(--panel-raised)' }}
    >
      <button type="button" className="flex flex-col gap-2.5 text-left" onClick={onChat}>
        {body}
      </button>
      <div className="flex items-center gap-2 border-t border-border pt-2">
        <span className="num text-[10.5px] text-faint">{formatTokens(entry.tokens)} tok</span>
        <button
          type="button"
          className="btn btn-ghost ml-auto"
          style={{ padding: '0.25rem 0.5rem' }}
          onClick={onChat}
        >
          <IconUsers size={11} />
          {entry.chat ? 'Open chat' : 'Chat'}
        </button>
        <button
          type="button"
          className="icon-btn shrink-0 opacity-60 transition-opacity hover:opacity-100"
          style={{ width: 24, height: 24 }}
          onClick={onEdit}
          aria-label={`Edit ${entry.name}`}
          title={`Edit ${entry.name}`}
        >
          <IconPen size={12} />
        </button>
      </div>
    </div>
  );
}
