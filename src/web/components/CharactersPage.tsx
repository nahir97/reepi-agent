/**
 * Characters: the app-wide roster, personas included.
 *
 * This page exists because two different questions had no home above a story:
 * *who do I have to talk to*, and *who am I when I talk to them*. The cast page
 * answers the payload question — what this story sends, totalled in tokens — and
 * it stays exactly that. This one is the library: every character in the app
 * grouped by the story that wrote them, and every persona grouped by the pool it
 * belongs to.
 *
 * Personas are deliberately here and not in the character library proper. A
 * persona is still story-scoped (`personas.story_id` is a real foreign key, and
 * `is_default` is a property of a pool), so this page does not pretend they are
 * library objects — it names the story each one belongs to, and creating one
 * either writes into the open story's pool or says out loud that it is going to
 * ask the assistant, which is the app's one way to author structure with no
 * story open.
 *
 * The card itself is `RosterCard`, shared with the cast page and Discover, so a
 * character cannot look like three different things in three places.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Character, Persona, Story } from '../../shared/types.ts';
import { useStore, type CardKind } from '../store.ts';
import { PageBand } from './panel.tsx';
import { RosterCard } from './RosterCard.tsx';
import { IconPlus, IconSearch, IconUser } from './icons.tsx';

type Scope = 'all' | 'character' | 'persona';
type SortKey = 'recent' | 'name' | 'tokens';

const SCOPE_LABELS: { id: Scope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'character', label: 'Characters' },
  { id: 'persona', label: 'Personas' },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'recent', label: 'Recently updated' },
  { id: 'name', label: 'Name' },
  { id: 'tokens', label: 'Weight in the payload' },
];

/** One card, whichever table it came from. The same shape the cast page builds. */
type Entry = {
  id: string;
  kind: CardKind;
  name: string;
  sub: string;
  avatar: string | null;
  tokens: number;
  updatedAt: number;
  badge?: string;
  chat: Story | null;
  homeStoryId: string | null;
  castHere: boolean;
  castCount: number;
};

export function CharactersPage() {
  const bundle = useStore((state) => state.bundle);
  const stories = useStore((state) => state.stories);
  const castLibrary = useStore((state) => state.castLibrary);
  const castLibraryError = useStore((state) => state.castLibraryError);
  const loadCastLibrary = useStore((state) => state.loadCastLibrary);
  const setPage = useStore((state) => state.setPage);
  const openStory = useStore((state) => state.openStory);
  const openChatWith = useStore((state) => state.openChatWith);
  const addToCast = useStore((state) => state.addToCast);
  const removeFromCast = useStore((state) => state.removeFromCast);
  const createCard = useStore((state) => state.createCard);
  const setCreatorTarget = useStore((state) => state.setCreatorTarget);
  const openDialog = useStore((state) => state.openDialog);

  const [scope, setScope] = useState<Scope>('character');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');

  /* The library is app-scoped and only fetched when a surface asks for it. This page
     *is* that surface for the roster, so it asks — without this it rendered "No
     characters yet" while the load it never started was still pending, which is how a
     library of six cards looked empty and a character the writer knew about looked
     missing. */
  useEffect(() => {
    void loadCastLibrary();
  }, [loadCastLibrary]);

  const storyId = bundle?.story.id ?? null;
  const isChat = Boolean(bundle?.story.characterId);
  const canCast = storyId !== null && !isChat;

  /* Personas are story-scoped rows, so with no story open there is no pool to
     list. The page says so rather than showing an empty section. */
  const personaStories = useMemo(() => {
    const ids = new Set<string>();
    if (storyId) ids.add(storyId);
    for (const story of stories) if (story.id === storyId) ids.add(story.id);
    return ids;
  }, [stories, storyId]);

  const chats = useMemo(() => new Map(stories.filter((s) => s.characterId).map((s) => [s.characterId ?? '', s])), [stories]);

  const castCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of castLibrary?.casts ?? []) counts.set(entry.characterId, (counts.get(entry.characterId) ?? 0) + 1);
    return counts;
  }, [castLibrary]);

  const castHere = useMemo(() => new Set((bundle?.characters ?? []).map((c) => c.id)), [bundle]);
  const characters = castLibrary?.characters ?? [];
  const personas = bundle?.personas ?? [];

  const matchedCharacters = useMemo(
    () => filterAndSort(characters, query, sort),
    [characters, query, sort],
  );
  const matchedPersonas = useMemo(() => filterAndSort(personas, query, sort), [personas, query, sort]);

  /* The card needs facts from three places — the card row, the chat that may
     exist for it, and the cast index — so they are joined once here rather than
     three lookups per card inside the grid. */
  const characterEntries = useMemo<Entry[]>(
    () =>
      matchedCharacters.map((character) => ({
        id: character.id,
        kind: 'character',
        name: character.name,
        sub: character.tagline || 'no tagline yet',
        avatar: character.avatar,
        tokens: character.tokens,
        updatedAt: character.updatedAt,
        homeStoryId: character.homeStoryId,
        chat: chats.get(character.id) ?? null,
        castHere: castHere.has(character.id),
        castCount: castCount.get(character.id) ?? 0,
      })),
    [matchedCharacters, chats, castHere, castCount],
  );

  const wantCharacters = scope !== 'persona';
  const wantPersonas = scope !== 'character';
  const total = characters.length + personas.length;

  /* Grouped by home story, because that is the question the library answers:
     where does this card belong. */
  const characterGroups = useMemo(
    () => groupByHome(characterEntries, stories, storyId, bundle?.story.title ?? null),
    [characterEntries, stories, storyId, bundle],
  );

  const personaByStory = useMemo(() => {
    const buckets = new Map<string, Persona[]>();
    for (const persona of matchedPersonas) {
      const list = buckets.get(persona.storyId);
      if (list) list.push(persona);
      else buckets.set(persona.storyId, [persona]);
    }
    return buckets;
  }, [matchedPersonas]);

  const personaGroupOrder = useMemo(() => {
    const order: string[] = [];
    if (storyId && personaByStory.has(storyId)) order.push(storyId);
    for (const story of stories) if (story.id !== storyId && personaByStory.has(story.id)) order.push(story.id);
    for (const key of personaByStory.keys()) if (!order.includes(key)) order.push(key);
    return order;
  }, [personaByStory, stories, storyId]);

  const addPersona = (): void => {
    if (storyId && bundle) void createCard('persona');
    else {
      setCreatorTarget(null);
      setPage('creator');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <PageBand
        title="Characters"
        hint={`${total} card${total === 1 ? '' : 's'} app-wide${
          storyId ? ` · ${bundle?.characters.length ?? 0} in “${bundle?.story.title ?? ''}”` : ''
        }`}
        onBack={() => setPage(bundle ? 'story' : 'discover')}
        actions={
          <>
            <button
              type="button"
              className="btn"
              style={{ padding: '0.35rem 0.6rem' }}
              onClick={addPersona}
              title={
                storyId && bundle
                  ? `Add a persona to the pool of “${bundle.story.title}”`
                  : 'No story is open, so the creation assistant will write it'
              }
            >
              <IconUser size={12} />
              Persona
            </button>
            {canCast ? (
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '0.35rem 0.6rem' }}
                onClick={() => void createCard('character')}
              >
                <IconPlus size={12} />
                Character
              </button>
            ) : null}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[64rem] px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[13rem] flex-1">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">
                <IconSearch size={13} />
              </span>
              <label className="sr-only" htmlFor="characters-search">
                Search characters and personas
              </label>
              <input
                id="characters-search"
                className="field field-sm pl-7"
                type="search"
                value={query}
                placeholder="Search by name, or by what the card says"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div
              className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
              role="group"
              aria-label="Which cards to show"
            >
              {SCOPE_LABELS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="rounded-sm px-2 py-1 text-[11.5px] font-medium transition-colors"
                  style={{
                    background: scope === option.id ? 'var(--accent-soft)' : 'transparent',
                    color: scope === option.id ? 'var(--accent)' : 'var(--text-faint)',
                  }}
                  aria-pressed={scope === option.id}
                  onClick={() => setScope(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className="sr-only" htmlFor="characters-sort">
              Sort the roster
            </label>
            <select
              id="characters-sort"
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

          {castLibraryError ? (
            <p className="mt-4 text-[12.5px] leading-snug text-faint">
              Could not read your character library — {castLibraryError}.{' '}
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => void loadCastLibrary()}
              >
                Try again
              </button>
            </p>
          ) : null}

          {!storyId ? (
            <p className="mt-4 text-[12.5px] leading-snug text-faint">
              No story is open, so the persona pools are not loaded. Open a story, or ask the{' '}
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => {
                  setCreatorTarget(null);
                  setPage('creator');
                }}
              >
                creation assistant
              </button>{' '}
              for one.
            </p>
          ) : null}

          {/* ------------------------------------------------------- characters */}

          {wantCharacters ? (
            characterGroups.length === 0 ? (
              <p className="mt-5 text-[12.5px] leading-snug text-faint">
                {characters.length === 0
                  ? 'No characters yet. Import a card, or ask the creation assistant to write some.'
                  : `Nothing matches ${query.trim() ? `“${query.trim()}”` : 'that filter'}.`}
              </p>
            ) : (
              characterGroups.map((group) => (
                <section key={group.key || 'none'} className="mt-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="eyebrow truncate">{group.label}</span>
                    <span className="num text-[10px] text-faint">{group.items.length}</span>
                  </div>
                  <ul className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}>
                    {group.items.map((entry) => (
                      <li key={entry.id}>
                        <CharacterEntry
                          entry={entry}
                          storyTitle={bundle?.story.title ?? ''}
                          canCast={canCast}
                          inChat={isChat}
                          onOpen={() => (entry.chat ? void openStory(entry.chat.id) : void openChatWith(entry.id))}
                          onEdit={() => openDialog({ kind: 'card', card: 'character', id: entry.id })}
                          onAdd={() => void addToCast(entry.id)}
                          onRemove={() => void removeFromCast(entry.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )
          ) : null}

          {/* --------------------------------------------------------- personas */}

          {wantPersonas ? (
            personaGroupOrder.length === 0 ? (
              <p className="mt-5 text-[12.5px] leading-snug text-faint">
                {matchedPersonas.length === 0 && !storyId
                  ? 'Personas are per story, so they appear here once a story is open.'
                  : 'No personas in this pool yet. Add one, and the model reads it as you on every turn.'}
              </p>
            ) : (
              personaGroupOrder.map((key) => (
                <section key={`persona-${key}`} className="mt-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="eyebrow truncate">
                      Personas{personaStories.has(key) && storyId === key ? ' · this story' : key ? ` · ${storyTitle(stories, key)}` : ''}
                    </span>
                    <span className="num text-[10px] text-faint">{personaByStory.get(key)?.length ?? 0}</span>
                  </div>
                  <ul className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}>
                    {(personaByStory.get(key) ?? []).map((persona) => (
                      <li key={persona.id}>
                        <RosterCard
                          kind="persona"
                          name={persona.name}
                          sub={persona.description ? firstLine(persona.description) : 'no description yet'}
                          avatar={persona.avatar}
                          tokens={persona.tokens}
                          badges={
                            persona.id === bundle?.story.personaId ? (
                              <span className="chip chip-hit">active</span>
                            ) : persona.isDefault ? (
                              <span className="chip chip-accent">default</span>
                            ) : null
                          }
                          onEdit={() => openDialog({ kind: 'card', card: 'persona', id: persona.id })}
                          onOpen={null}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )
          ) : null}

          {!castLibrary && !castLibraryError ? (
            <p className="mt-4 text-[12.5px] text-faint">Reading your character library…</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function CharacterEntry({
  entry,
  storyTitle: title,
  canCast,
  inChat,
  onOpen,
  onEdit,
  onAdd,
  onRemove,
}: {
  entry: Entry;
  storyTitle: string;
  canCast: boolean;
  inChat: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const blocked = entry.homeStoryId === null && !entry.castHere;
  return (
    <RosterCard
      kind="character"
      name={entry.name}
      sub={entry.sub}
      avatar={entry.avatar}
      tokens={entry.tokens}
      badges={
        <>
          {entry.badge ? <span className="chip chip-hit">{entry.badge}</span> : null}
          {entry.homeStoryId === null ? (
            <span className="chip" title="The story that wrote this card was deleted. The card outlived it.">
              no home story
            </span>
          ) : null}
          {entry.castCount > 1 ? (
            <span className="chip" title={`Cast in ${entry.castCount} stories`}>
              in {entry.castCount} casts
            </span>
          ) : null}
        </>
      }
      chips={entry.chat ? <span className="chip">in a chat</span> : null}
      onEdit={onEdit}
      onOpen={inChat ? null : blocked ? null : onOpen}
      openLabel={entry.chat ? 'Open chat' : 'Chat'}
      openBlockedReason={
        blocked ? 'This card outlived its home story. Cast it into a story, then start the chat from there.' : undefined
      }
      action={
        !canCast ? null : entry.castHere ? null : (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.25rem 0.5rem' }}
            onClick={onAdd}
            aria-label={`Add ${entry.name} to the cast of ${title}`}
            title={`Add ${entry.name} to the cast of ${title}`}
          >
            <IconPlus size={11} />
            Add to story
          </button>
        )
      }
    />
  );
}

/* ------------------------------------------------------------------ helpers */

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 96 ? `${line.slice(0, 96)}…` : line;
}

function filterAndSort<T extends { name: string; tokens: number; updatedAt: number }>(
  list: T[],
  query: string,
  sort: SortKey,
): T[] {
  const needle = query.trim().toLowerCase();
  const matched = list.filter((entry) => needle === '' || entry.name.toLowerCase().includes(needle));
  const sorted = [...matched];
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'tokens') sorted.sort((a, b) => b.tokens - a.tokens);
  else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted;
}

function groupByHome(
  entries: Entry[],
  stories: Story[],
  openStoryId: string | null,
  openStoryTitle: string | null,
): { key: string; label: string; items: Entry[] }[] {
  const buckets = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = entry.homeStoryId ?? '';
    const list = buckets.get(key);
    if (list) list.push(entry);
    else buckets.set(key, [entry]);
  }

  const ordered: { key: string; label: string }[] = [];
  if (openStoryId && buckets.has(openStoryId)) {
    ordered.push({ key: openStoryId, label: `This story · ${openStoryTitle ?? 'untitled'}` });
  }
  for (const story of stories) {
    if (story.id === openStoryId || !buckets.has(story.id)) continue;
    ordered.push({ key: story.id, label: story.title });
  }
  /* A home story the library list does not know about should be impossible — the
     foreign key nulls it — but dropping the group would silently hide a card. */
  for (const key of buckets.keys()) {
    if (key === '' || ordered.some((group) => group.key === key)) continue;
    ordered.push({ key, label: 'Another story' });
  }
  if (buckets.has('')) ordered.push({ key: '', label: 'No home story' });

  return ordered.map((group) => ({ ...group, items: buckets.get(group.key) ?? [] }));
}

function storyTitle(stories: Story[], id: string): string {
  return stories.find((story) => story.id === id)?.title ?? 'Another story';
}
