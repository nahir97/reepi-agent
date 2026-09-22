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
 * **Two scopes, because a character is not owned by a story.**
 *
 * - `This story` is the payload: exactly the cards the composer sends, priced
 *   into this story's prefix. It is the default inside a story, and its band
 *   states the token cost, because that is the one number here a writer acts on.
 * - `Library` is every character in the app, grouped by the story it came from.
 *   This is where a blank story gets a cast: a card is *adopted* into the open
 *   story, never copied, so one edit reaches every story that casts it. The band
 *   states no token total there — those tokens are not in any open prefix — only
 *   the per-card weight, which belongs to the card wherever it is cast.
 *
 * Personas are deliberately absent from `Library`: a persona is the writer's mask
 * *for a story*, not a library object, so it stays in the story scope beside the
 * cards it is sent with.
 *
 * What else it shows, and why:
 *
 * - **Characters and personas as one roster** in the story scope, filterable,
 *   because "who is in this story, and who am I" is one question even though it
 *   is two tables.
 * - **The token count on every card**, because these cards sit in the frozen
 *   prefix: a 400-token card is a permanent 400 tokens on every request, and
 *   that is the one number here a writer acts on. It comes from the bundle the
 *   server computed, never from a client estimate.
 * - **No tags, no favourites, no creator fields.** Characters imported from a
 *   card carry tags inside `meta`, but `meta` is a freeform blob with no schema
 *   any UI writes; a filter over it would be a filter over nothing.
 *
 * The prose stays one row below this in the App: the composer is hidden while a
 * page is up, because a page is not a place to write.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatTokens } from '../../shared/cost.ts';
import type { Character, Persona, Story } from '../../shared/types.ts';
import { useStore, type CardKind } from '../store.ts';
import { Avatar } from './Avatar.tsx';
import { PageBand } from './panel.tsx';
import { IconPen, IconPlus, IconSearch, IconUser, IconUsers } from './icons.tsx';

/* ------------------------------------------------------------------- model */

/** Which roster the page is showing. */
type Scope = 'story' | 'library';

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
  /** The story that authored the card; `null` once that story is gone. */
  homeStoryId: string | null;
  /** How many stories cast this card. Characters only. */
  castCount: number;
  /** Whether the open story's payload already carries it. Characters only. */
  castHere: boolean;
};

type SortKey = 'recent' | 'name' | 'tokens';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'recent', label: 'Recently updated' },
  { id: 'name', label: 'Name' },
  { id: 'tokens', label: 'Weight in the payload' },
];

/** What the entries need to know about the open story, or `null` with none open. */
type CastContext = {
  storyId: string | null;
  /** The open story is a chat: its cast is borrowed, so it can only be edited. */
  inChat: boolean;
  /** Ids cast in the open story. */
  castHere: Set<string>;
  /** Cast count per character, across the whole library. */
  castCount: Map<string, number>;
};

function entriesOf(
  characters: Character[],
  personas: Persona[],
  personaId: string | null,
  chats: Story[],
  context: CastContext,
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
        homeStoryId: character.homeStoryId,
        castCount: context.castCount.get(character.id) ?? 0,
        castHere: context.castHere.has(character.id),
        /* Inside a chat the card *is* that chat, so "has a chat" would be a chip
           stating the obvious. It is a fact about the roster outside one. */
        chat: context.inChat ? null : (chatOf.get(character.id) ?? null),
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
        homeStoryId: context.storyId,
        castCount: 0,
        castHere: true,
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
  const castLibrary = useStore((state) => state.castLibrary);
  const castLibraryError = useStore((state) => state.castLibraryError);
  const setPage = useStore((state) => state.setPage);
  const createCard = useStore((state) => state.createCard);
  const startChatWith = useStore((state) => state.startChatWith);
  const addToCast = useStore((state) => state.addToCast);
  const removeFromCast = useStore((state) => state.removeFromCast);
  const loadCastLibrary = useStore((state) => state.loadCastLibrary);
  const openDialog = useStore((state) => state.openDialog);

  /* Opened from a story, the payload roster is the one that matters; opened from
     the palette with no story, the library is all there is. */
  const [scope, setScope] = useState<Scope>(() => (bundle ? 'story' : 'library'));
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | CardKind>('all');
  const [sort, setSort] = useState<SortKey>('recent');

  useEffect(() => {
    void loadCastLibrary();
  }, [loadCastLibrary]);

  const storyId = bundle?.story.id ?? null;
  const isChat = Boolean(bundle?.story.characterId);
  /* A chat's cast is its card, by construction, so the library scope is a place
     to browse from — never a place to add. */
  const canCast = storyId !== null && !isChat;

  const personaId = bundle?.story.personaId ?? null;
  /* A chat is a story with `characterId` set, so "does this card have a chat" is
     a question the library already answers — no extra endpoint, no extra field. */
  const chats = useMemo(() => stories.filter((story) => story.characterId !== null), [stories]);

  const context = useMemo((): CastContext => {
    const castHere = new Set((bundle?.characters ?? []).map((character) => character.id));
    const castCount = new Map<string, number>();
    for (const entry of castLibrary?.casts ?? []) {
      castCount.set(entry.characterId, (castCount.get(entry.characterId) ?? 0) + 1);
    }
    return { storyId, inChat: isChat, castHere, castCount };
  }, [bundle, castLibrary, storyId, isChat]);

  const roster = useMemo(() => {
    if (scope === 'library') {
      return entriesOf(castLibrary?.characters ?? [], [], personaId, chats, context);
    }
    return entriesOf(bundle?.characters ?? [], bundle?.personas ?? [], personaId, chats, context);
  }, [scope, castLibrary, bundle, personaId, chats, context]);

  /* Search matches the name and the line under it. `sub` is included because a
     writer looks for "the steward" as often by what the card says as by what it
     is called. The library scope shows one kind — personas are story-scoped — so
     the kind filter only applies where there is more than one. */
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = roster.filter(
      (entry) =>
        (scope === 'library' || kind === 'all' || entry.kind === kind) &&
        (needle === '' || `${entry.name} ${entry.sub}`.toLowerCase().includes(needle)),
    );
    const sorted = [...filtered];
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'tokens') sorted.sort((a, b) => b.tokens - a.tokens);
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }, [roster, query, kind, sort, scope]);

  /* Grouped by kind in the story scope and by home story in the library, because
     that is the question each scope answers: "what is in this payload" and "where
     does this character belong".
     
     A filter is a request for one list, so headings drop away once the kind
     filter narrows things in the story scope — the writer just asked for that
     split. The library's story headings stay: they are the ordering. */
  const groups = useMemo(() => {
    if (scope === 'story' && kind !== 'all') {
      return [{ key: kind, label: null as string | null, items: matched }];
    }
    if (scope === 'story') {
      return [
        { key: 'character', label: 'Characters', items: matched.filter((entry) => entry.kind === 'character') },
        { key: 'persona', label: 'Personas', items: matched.filter((entry) => entry.kind === 'persona') },
      ].filter((group) => group.items.length > 0);
    }

    const buckets = new Map<string, RosterEntry[]>();
    for (const entry of matched) {
      const key = entry.homeStoryId ?? '';
      const bucket = buckets.get(key);
      if (bucket) bucket.push(entry);
      else buckets.set(key, [entry]);
    }

    const ordered: { key: string; label: string }[] = [];
    if (storyId && buckets.has(storyId)) {
      ordered.push({ key: storyId, label: `This story · ${bundle?.story.title ?? 'untitled'}` });
    }
    for (const story of stories) {
      if (story.id === storyId || !buckets.has(story.id)) continue;
      ordered.push({ key: story.id, label: story.title });
    }
    /* A home story the library list does not know about should be impossible —
       the foreign key cascades — but dropping the group would silently hide a
       card, which is worse than a plain heading. */
    for (const key of buckets.keys()) {
      if (key === '' || ordered.some((group) => group.key === key)) continue;
      ordered.push({ key, label: 'Another story' });
    }
    if (buckets.has('')) ordered.push({ key: '', label: 'No home story' });

    return ordered.map((group) => ({ ...group, items: buckets.get(group.key) ?? [] }));
  }, [scope, kind, matched, storyId, bundle, stories]);

  const totalTokens = roster.reduce((sum, entry) => sum + entry.tokens, 0);
  const homeStories = new Set(roster.map((entry) => entry.homeStoryId).filter(Boolean)).size;
  const castHere = roster.filter((entry) => entry.kind === 'character' && entry.castHere).length;
  const storyCharacters = bundle?.characters ?? [];
  const libraryCharacters = castLibrary?.characters ?? [];
  /* Every story is born with a persona and no characters, so the roster is never
     empty in the story scope and the empty state below never fires. Without this
     line the writer's library would be invisible on exactly the page that is
     supposed to lead to it. */
  const showLibraryHint =
    scope === 'story' && !isChat && storyCharacters.length === 0 && libraryCharacters.length > 0;

  if (scope === 'story' && !bundle) {
    return (
      <div className="flex h-full flex-col">
        <PageBand onBack={() => setPage('story')} title="Cast" />
        <p className="px-4 py-6 text-[12.5px] text-faint">Open a story first — a cast belongs to one.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <PageBand
        onBack={() => setPage('story')}
        title={scope === 'library' ? 'Character library' : isChat ? `Cast of ${bundle?.story.title ?? ''}` : 'Cast'}
        hint={
          scope === 'library'
            ? storyId
              ? /* The group headings already name the stories, so with a story
                   open the useful second fact is how many are in *its* payload —
                   and it keeps the line inside the band on a phone. */
                `${roster.length} character${roster.length === 1 ? '' : 's'} · ${castHere} cast here`
              : `${roster.length} character${roster.length === 1 ? '' : 's'} · ${homeStories} stor${homeStories === 1 ? 'y' : 'ies'}`
            : `${roster.length} card${roster.length === 1 ? '' : 's'} · ${formatTokens(totalTokens)} tokens in the prefix`
        }
        actions={
          <>
            {/* A persona is the writer's mask for a story, so it is created where
                it will be sent — never from the library scope. */}
            {scope === 'story' ? (
              <button type="button" className="btn" style={{ padding: '0.35rem 0.6rem' }} onClick={() => void createCard('persona')}>
                <IconUser size={12} />
                Persona
              </button>
            ) : null}
            {/* A new card is authored in the story you are in. Inside a chat there
                is nothing to add: a chat has exactly one character. */}
            {canCast ? (
              <button type="button" className="btn btn-primary" style={{ padding: '0.35rem 0.6rem' }} onClick={() => void createCard('character')}>
                <IconPlus size={12} />
                Character
              </button>
            ) : null}
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

            {/* The scope is the page's first question: this payload, or everyone
                you have written. It only exists once a story is open — with no
                story there is no "this story" to show. */}
            {bundle ? (
              <div
                className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
                role="group"
                aria-label="Choose which cast to show"
              >
                {(['story', 'library'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="rounded-sm px-2 py-1 text-[11.5px] font-medium transition-colors"
                    style={{
                      background: scope === option ? 'var(--accent-soft)' : 'transparent',
                      color: scope === option ? 'var(--accent)' : 'var(--text-faint)',
                    }}
                    aria-pressed={scope === option}
                    onClick={() => setScope(option)}
                  >
                    {option === 'story' ? 'This story' : 'Library'}
                  </button>
                ))}
              </div>
            ) : null}

            {/* Filtering is a segmented control rather than a select: three fixed
                options, and seeing them is how the writer learns personas and
                characters share this page. The library scope holds one kind, so
                the control would be a switch with one position. */}
            {scope === 'story' ? (
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
            ) : null}

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

          {showLibraryHint ? (
            <p className="mt-5 text-[12.5px] leading-snug text-faint">
              No one is cast in this story yet.{' '}
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => setScope('library')}>
                Browse your {libraryCharacters.length} character{libraryCharacters.length === 1 ? '' : 's'}
              </button>{' '}
              to add someone — a card sits at the front of every request, so it is a choice worth making.
            </p>
          ) : null}

          {matched.length === 0 ? (
            <p className="mt-5 text-[12.5px] leading-snug text-faint">
              {scope === 'library' ? (
                castLibraryError ? (
                  <>
                    Could not read your character library — {castLibraryError}.{' '}
                    <button type="button" className="font-medium text-accent hover:underline" onClick={() => void loadCastLibrary()}>
                      Try again
                    </button>
                  </>
                ) : castLibrary === null ? (
                  'Reading your character library…'
                ) : (
                  'No characters yet. Open a story to write one.'
                )
              ) : isChat && storyCharacters.length === 0 ? (
                'The card this chat was started from is gone, so there is nothing to show here. The conversation is still yours.'
              ) : roster.length === 0 ? (
                'No one in this story yet. Add a character, or write a persona for yourself — both sit at the front of every request.'
              ) : (
                `Nothing matches ${query.trim() ? `“${query.trim()}”` : 'that filter'}.`
              )}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="mt-5">
                {group.label ? (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="eyebrow truncate">{group.label}</span>
                    <span className="num text-[10px] text-faint">{group.items.length}</span>
                  </div>
                ) : null}
                <ul className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}>
                  {group.items.map((entry) => (
                    <li key={`${entry.kind}-${entry.id}`}>
                      <RosterCard
                        entry={entry}
                        storyTitle={bundle?.story.title ?? ''}
                        canCast={canCast}
                        onEdit={() => openDialog({ kind: 'card', card: entry.kind, id: entry.id })}
                        /* Characters outside their own chat get the chat action.
                           Personas never do — they are the writer's mask, not
                           someone to talk to — and inside a chat you are already in
                           the conversation that card would open. */
                        onChat={
                          entry.kind === 'character' && !isChat
                            ? () => void startChatWith(entry.id, chatSourceFor(entry, storyId))
                            : null
                        }
                        onAdd={entry.kind === 'character' && !entry.castHere ? () => void addToCast(entry.id) : null}
                        onRemove={
                          entry.kind === 'character' && entry.castHere && entry.homeStoryId !== storyId
                            ? () => void removeFromCast(entry.id)
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

/**
 * The world a chat would be seeded with, when the card's home story is gone.
 *
 * `null` means "use the card's home" and is the normal case. A card that outlived
 * its home can only draw a world from a story that actually casts it, so the open
 * story is offered only when it is one of them.
 */
function chatSourceFor(entry: RosterEntry, storyId: string | null): string | undefined {
  if (entry.kind !== 'character') return undefined;
  if (entry.homeStoryId !== null) return undefined;
  if (!storyId || !entry.castHere) return undefined;
  return storyId;
}

/* -------------------------------------------------------------- roster card */

/**
 * Two card shapes, one visual language.
 *
 * With a chat action the card cannot be a single button — the pencil inside it
 * would be a button inside a button — so the top half is the button that opens
 * the conversation and the footer holds the explicit controls. Without one (a
 * persona, or a character inside its own chat) the whole card stays the single
 * button it has always been, because opening the editor is the only thing it can
 * do.
 *
 * The footer is `flex-wrap` because the library scope adds a cast control to it:
 * a card at the narrowest column would otherwise push the pencil out of the card
 * rather than onto a second line.
 *
 * The pencil is dim rather than invisible. A control revealed on hover is a
 * control a touch device never finds — the same trap the story rows were fixed
 * for.
 */
function RosterCard({
  entry,
  storyTitle,
  canCast,
  onChat,
  onEdit,
  onAdd,
  onRemove,
}: {
  entry: RosterEntry;
  storyTitle: string;
  canCast: boolean;
  onChat: (() => void) | null;
  onEdit: () => void;
  onAdd: (() => void) | null;
  onRemove: (() => void) | null;
}) {
  /* A card whose home story was deleted has no world to seed a chat from. It can
     still be cast, edited and adopted — the one thing it cannot do is start a
     conversation on its own, and saying so is better than a button that 409s. */
  const chatBlocked = entry.kind === 'character' && entry.homeStoryId === null && !entry.castHere;

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
            {entry.kind === 'character' && entry.homeStoryId === null ? (
              <span className="chip" title="The story that wrote this card was deleted. The card outlived it.">
                no home story
              </span>
            ) : null}
            {entry.kind === 'character' && entry.castCount > 1 ? (
              <span className="chip" title={`Cast in ${entry.castCount} stories`}>
                in {entry.castCount} casts
              </span>
            ) : null}
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

  const castAction =
    onAdd && canCast ? (
      <button
        type="button"
        className="btn btn-ghost"
        style={{ padding: '0.25rem 0.5rem' }}
        onClick={onAdd}
        aria-label={`Add ${entry.name} to the cast of ${storyTitle}`}
        title={`Add ${entry.name} to the cast of ${storyTitle}`}
      >
        <IconPlus size={11} />
        Add to story
      </button>
    ) : onRemove ? (
      <button
        type="button"
        className="btn btn-ghost"
        style={{ padding: '0.25rem 0.5rem' }}
        onClick={onRemove}
        aria-label={`Remove ${entry.name} from the cast of ${storyTitle}`}
        title={`Remove ${entry.name} from the cast of ${storyTitle}`}
      >
        Remove
      </button>
    ) : null;

  if (!onChat) {
    return (
      <button
        type="button"
        className="card group flex h-full w-full flex-col gap-2.5 p-3 text-left transition-colors hover:border-[var(--border-strong)]"
        style={{ background: 'var(--panel-raised)' }}
        onClick={onEdit}
      >
        {body}
        <span className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-2">
          <span className="num text-[10.5px] text-faint">{formatTokens(entry.tokens)} tok</span>
          {castAction ? <span className="ml-auto">{castAction}</span> : null}
          <span className={`${castAction ? '' : 'ml-auto'} text-[11px] font-medium text-accent`}>Edit</span>
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
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <span className="num text-[10.5px] text-faint">{formatTokens(entry.tokens)} tok</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {castAction}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.25rem 0.5rem' }}
            onClick={onChat}
            disabled={chatBlocked}
            aria-label={
              chatBlocked
                ? `${entry.name} cannot start a chat — the story that wrote the card was deleted`
                : entry.chat
                  ? `Open the chat with ${entry.name}`
                  : `Start a chat with ${entry.name}`
            }
            title={
              chatBlocked
                ? 'This card outlived its home story. Cast it into a story, then start the chat from there.'
                : undefined
            }
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
    </div>
  );
}
