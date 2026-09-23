/**
 * Discover: the launcher.
 *
 * This is the surface the friction asked for. Before it existed, landing in the
 * studio meant the newest story existed on screen and a character was four
 * gestures away — studio list, cast page, scope toggle, card. The product's
 * engaging act is *talking to someone*, so the front page is a roster of the
 * people you have, each one gesture from a conversation, with the conversations
 * you already have above them.
 *
 * Three deliberate omissions, each the same rule:
 *
 * - **No cost, no hit rate, no token count on a conversation row.** A figure
 *   appears by default only if the writer must act on it to keep writing. A
 *   chat's price is worth knowing deliberately, which is what the rail's Payload
 *   and Cost & cache sections are for.
 * - **No `POPULAR` hashtag list invented client-side.** The filter row is derived
 *   from the tags the cards actually carry (the importer parks them in
 *   `Character.meta`), ordered by frequency, and it is absent entirely when
 *   there is nothing to filter by.
 * - **No "story" hero.** A chat is a story with `characterId` set, so the two
 *   lists are split by that one fact and neither invents a second kind of thing.
 *
 * There is no separate band for plain stories. The rail beside the launcher is
 * already the full, day-filed library, and a launcher that repeats an adjacent
 * list is a list nobody reads — so a story appears here only as one of the recent
 * conversations, and `New story` is one button in the band.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { dayBucket } from '../../shared/text.ts';
import type { Character } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { Avatar } from './Avatar.tsx';
import { PageBand } from './panel.tsx';
import { RosterCard, characterTags } from './RosterCard.tsx';
import { StoryActions } from './StoryActions.tsx';
import { IconPlus, IconSearch, IconUpload, IconUsers } from './icons.tsx';

/** Launcher sections are capped; the rail owns the complete lists. */
const CONTINUE_LIMIT = 6;
const CHARACTER_LIMIT = 24;

export function DiscoverPage() {
  const stories = useStore((state) => state.stories);
  const castLibrary = useStore((state) => state.castLibrary);
  const castLibraryError = useStore((state) => state.castLibraryError);
  const loadCastLibrary = useStore((state) => state.loadCastLibrary);
  const openStory = useStore((state) => state.openStory);
  const startChatWith = useStore((state) => state.startChatWith);
  const setPage = useStore((state) => state.setPage);
  const openDialog = useStore((state) => state.openDialog);

  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);

  useEffect(() => {
    void loadCastLibrary();
  }, [loadCastLibrary]);

  const chats = useMemo(() => stories.filter((story) => story.characterId !== null), [stories]);
  const characters = castLibrary?.characters ?? [];

  /* ------------------------------------------------------------------ tags */

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const character of characters) {
      for (const value of characterTags(character, 8)) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }, [characters]);

  /* Frequency order, ties broken alphabetically so the row does not reshuffle
     between loads. Two distinct tags is the minimum at which a filter row is a
     filter rather than decoration. */
  const popularTags = useMemo(() => {
    if (tagCounts.size < 2) return [];
    return [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([value]) => value);
  }, [tagCounts]);

  /* A tag selected in one search must not survive into another story's library. */
  useEffect(() => {
    if (tag && !tagCounts.has(tag)) setTag(null);
  }, [tag, tagCounts]);

  /* ------------------------------------------------------------- resolution */

  const chatOf = useMemo(() => new Map(chats.map((chat) => [chat.characterId ?? '', chat])), [chats]);
  const castHere = useMemo(
    () => new Set((castLibrary?.casts ?? []).map((entry) => entry.characterId)),
    [castLibrary],
  );

  const needle = query.trim().toLowerCase();

  const recent = useMemo(
    () => [...stories].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CONTINUE_LIMIT),
    [stories],
  );

  const matchedCharacters = useMemo(() => {
    const matched = characters.filter((character) => {
      if (tag && !characterTags(character, 8).includes(tag)) return false;
      if (!needle) return true;
      return `${character.name} ${character.tagline} ${characterTags(character, 8).join(' ')}`
        .toLowerCase()
        .includes(needle);
    });
    return matched.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CHARACTER_LIMIT);
  }, [characters, tag, needle]);

  const totalCharacters = characters.length;
  const storyCount = stories.length - chats.length;
  const hint = `${chats.length} conversation${chats.length === 1 ? '' : 's'} · ${totalCharacters} character${
    totalCharacters === 1 ? '' : 's'
  } · ${storyCount} stor${storyCount === 1 ? 'y' : 'ies'}`;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <PageBand
        title="Discover"
        hint={hint}
        onBack={() => setPage('story')}
        actions={
          <>
            <button
              type="button"
              className="btn"
              style={{ padding: '0.35rem 0.6rem' }}
              onClick={() => openDialog({ kind: 'import-export' })}
            >
              <IconUpload size={12} />
              Import
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '0.35rem 0.6rem' }}
              onClick={() => openDialog({ kind: 'new-story' })}
            >
              <IconPlus size={12} />
              Create
            </button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[64rem] px-4 py-4">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">
              <IconSearch size={13} />
            </span>
            <label className="sr-only" htmlFor="discover-search">
              Search conversations and characters
            </label>
            <input
              id="discover-search"
              className="field pl-7"
              type="search"
              value={query}
              placeholder="Search characters by name, tagline or tag, or find a conversation…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {/* ---------------------------------------------------------- continue */}

          {recent.length > 0 ? (
            <section className="mt-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="eyebrow">Continue</span>
                <span className="num text-[10px] text-faint">{recent.length}</span>
              </div>
              <ul className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}>
                {recent.map((story) => (
                  <li key={story.id}>
                    <ConversationCard
                      title={story.title}
                      avatarName={story.title}
                      avatar={
                        story.characterId
                          ? (characters.find((character) => character.id === story.characterId)?.avatar ?? null)
                          : null
                      }
                      at={story.updatedAt}
                      isChat={story.characterId !== null}
                      onOpen={() => void openStory(story.id)}
                      actions={<StoryActions key={story.id} story={story} />}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* -------------------------------------------------------- characters */}

          <section className="mt-6">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="eyebrow">Characters</span>
              <span className="num text-[10px] text-faint">{totalCharacters}</span>
              <button
                type="button"
                className="btn btn-ghost ml-auto"
                style={{ padding: '0.25rem 0.5rem' }}
                onClick={() => setPage('characters')}
              >
                <IconUsers size={11} />
                Personas &amp; library
              </button>
            </div>

            {popularTags.length > 0 ? (
              <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter characters by tag">
                <span className="eyebrow shrink-0">Popular</span>
                {popularTags.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    style={
                      tag === value
                        ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                        : undefined
                    }
                    aria-pressed={tag === value}
                    onClick={() => setTag(tag === value ? null : value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            ) : null}

            {castLibraryError ? (
              <p className="text-[12.5px] leading-snug text-faint">
                Could not read your character library — {castLibraryError}.{' '}
                <button
                  type="button"
                  className="font-medium text-accent hover:underline"
                  onClick={() => void loadCastLibrary()}
                >
                  Try again
                </button>
              </p>
            ) : castLibrary === null && totalCharacters === 0 ? (
              <p className="text-[12.5px] leading-snug text-faint">Reading your character library…</p>
            ) : totalCharacters === 0 ? (
              <p className="text-[12.5px] leading-snug text-faint">
                No characters yet. The{' '}
                <button
                  type="button"
                  className="font-medium text-accent hover:underline"
                  onClick={() => setPage('creator')}
                >
                  creation assistant
                </button>{' '}
                will write some from a sentence — or start a story and write one there.
              </p>
            ) : matchedCharacters.length === 0 ? (
              <p className="text-[12.5px] leading-snug text-faint">
                Nothing matches {needle ? `“${query.trim()}”` : 'that filter'}.
              </p>
            ) : (
              <ul className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}>
                {matchedCharacters.map((character) => (
                  <li key={character.id}>
                    <CharacterCard character={character} chat={chatOf.get(character.id) ?? null} castHere={castHere} />
                  </li>
                ))}
              </ul>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

/**
 * One launcher card: a portrait, a name, and how long ago it moved.
 *
 * There is no figure on it. Cost and hit rate are one deliberate action away in
 * the rail, and the one thing a writer does from this card is open it.
 *
 * The card is a `div` rather than one big button because it carries a row menu,
 * and a control inside a control is both invalid markup and two overlapping hit
 * targets. The open control and the menu are siblings.
 */
function ConversationCard({
  title,
  avatarName,
  avatar,
  at,
  isChat,
  onOpen,
  actions,
}: {
  title: string;
  avatarName: string;
  avatar: string | null;
  at: number;
  isChat: boolean;
  onOpen: () => void;
  actions: ReactNode;
}) {
  return (
    <div
      className="card flex h-full items-center gap-2.5 p-2.5 transition-colors hover:border-[var(--border-strong)]"
      style={{ background: 'var(--panel-raised)' }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        onClick={onOpen}
        aria-label={`Open ${title}`}
      >
        <Avatar name={avatarName} src={avatar} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate font-display text-[13.5px] leading-tight font-semibold">{title}</span>
            {isChat ? <span className="chip shrink-0">chat</span> : null}
          </span>
          <span className="mt-0.5 block truncate text-[10.5px] text-faint">
            {isChat ? 'in a conversation' : 'a story'} · {relativeDay(at)}
          </span>
        </span>
      </button>
      {actions}
    </div>
  );
}

/** One character, one gesture from talking to them. */
function CharacterCard({
  character,
  chat,
  castHere,
}: {
  character: Character;
  chat: { id: string } | null;
  castHere: Set<string>;
}) {
  const startChatWith = useStore((state) => state.startChatWith);
  const openStory = useStore((state) => state.openStory);
  const openDialog = useStore((state) => state.openDialog);
  const tags = characterTags(character);

  /* The card outlived its home story and is cast nowhere, so there is no world
     to seed a conversation from. A disabled button that says why beats one that
     answers with a 409. */
  const blocked = character.homeStoryId === null && !castHere.has(character.id);

  return (
    <RosterCard
      kind="character"
      name={character.name}
      sub={character.tagline || 'no tagline yet'}
      avatar={character.avatar}
      tokens={character.tokens}
      badges={character.homeStoryId === null ? <span className="chip">no home story</span> : null}
      chips={
        <>
          {tags.map((value) => (
            <span key={value} className="chip">
              {value}
            </span>
          ))}
          {chat ? <span className="chip">in a chat</span> : null}
        </>
      }
      onEdit={() => openDialog({ kind: 'card', card: 'character', id: character.id })}
      /* A card whose chat is unreachable falls back to its editor, which is the
         one place that can fix what is wrong with it — the cast control lives
         there. The empty callback is deliberate: the card must not claim a chat
         it cannot open, and the body must still do something. */
      onOpen={
        blocked
          ? () => undefined
          : chat
            ? () => void openStory(chat.id)
            : () => void startChatWith(character.id)
      }
      openLabel={chat ? 'Resume' : 'New chat'}
      openBlockedReason={
        blocked ? 'This card outlived its home story. Cast it into a story, then start the chat from there.' : undefined
      }
    />
  );
}

/**
 * Recent, in the writer's own words rather than as a timestamp.
 *
 * The library's day buckets exist for the same reason — "which was I in last
 * night" is how a session is remembered — so this reads the shared one instead
 * of inventing a second phrasing of the same fact.
 */
function relativeDay(at: number): string {
  const bucket = dayBucket(at);
  if (bucket === 'today') return 'today';
  if (bucket === 'yesterday') return 'yesterday';
  if (bucket === 'week') return 'this week';
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
