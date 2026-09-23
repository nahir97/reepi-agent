/**
 * The library: the conversations, and nothing else.
 *
 * One list, rendered in two hosts — the desktop rail and the phone's navigation
 * sheet. The phone previously had no story switcher at all (the rail is
 * `hidden lg:block` and the drawer that would have carried it was never opened
 * by anything), so the sheet is not a copy of the rail; it is the only route to
 * the library on a small screen. One implementation is what keeps that true.
 *
 * A story reads as a conversation: a portrait, the title, and one line of what
 * it has cost and saved. The day headers file it the way a writer remembers it —
 * "which was I in last night" — rather than by title.
 *
 * **The creation assistant and the new-story button used to live here, and no
 * longer do.** Both were rows at the top of a list of conversations, which put a
 * destination and an action inside a list of things — the concatenation that made
 * the rail hard to scan. The assistant is a destination in `StudioNav` now, and
 * `New story` is a control the rail and the launcher both provide above the list.
 * What is left here is what this list is actually for.
 */

import { useMemo, useState } from 'react';
import { formatPercent, formatTokens, formatUsd } from '../../shared/cost.ts';
import { DAY_BUCKET_LABEL, DAY_BUCKET_ORDER, dayBucket, type DayBucket } from '../../shared/text.ts';
import type { Story } from '../../shared/types.ts';
import { MODELS } from '../../shared/types.ts';
import { useStore } from '../store.ts';
import { THEME_COVER as COVER } from '../theme.ts';
import { StoryActions } from './StoryActions.tsx';
import { IconSearch } from './icons.tsx';

export function LibraryList({ onPick }: { onPick?: () => void }) {
  const stories = useStore((state) => state.stories);
  const stats = useStore((state) => state.storyStats);
  const activeStoryId = useStore((state) => state.activeStoryId);
  const openStory = useStore((state) => state.openStory);

  const [query, setQuery] = useState('');

  /* Newest first, then filed by calendar day. A search flattens the filing —
     the writer named what they wanted, so which day it happened stops mattering. */
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = [...stories]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((story) => needle === '' || story.title.toLowerCase().includes(needle));

    if (needle !== '') return [{ bucket: null as DayBucket | null, stories: matched }];

    const byDay: Record<DayBucket, Story[]> = { today: [], yesterday: [], week: [], earlier: [] };
    for (const story of matched) byDay[dayBucket(story.updatedAt)].push(story);

    return DAY_BUCKET_ORDER.filter((bucket) => byDay[bucket].length > 0).map((bucket) => ({
      bucket: bucket as DayBucket | null,
      stories: byDay[bucket],
    }));
  }, [stories, query]);

  const shown = groups.reduce((total, group) => total + group.stories.length, 0);

  return (
    <div>
      {/* ------------------------------------------------------------- search */}

      <div className="px-2 pt-3">
        <label className="sr-only" htmlFor="library-search">
          Search stories
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">
            <IconSearch size={13} />
          </span>
          <input
            id="library-search"
            className="field field-sm pl-7"
            type="search"
            value={query}
            placeholder="Search stories"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {/* ------------------------------------------------------------ stories */}

      {stories.length === 0 ? (
        <p className="px-3 py-3 text-[12px] leading-snug text-faint">
          No stories yet. Pick a starting point — the contract, genre and style come pre-filled, and those are the
          blocks you least want to keep editing.
        </p>
      ) : shown === 0 ? (
        <p className="px-3 py-3 text-[12px] leading-snug text-faint">No story matches “{query.trim()}”.</p>
      ) : (
        groups.map((group) => (
          <section key={group.bucket ?? 'matches'}>
            <div className="flex items-center gap-2 px-3 pt-4 pb-1.5">
              <span className="eyebrow">{group.bucket ? DAY_BUCKET_LABEL[group.bucket] : 'Matches'}</span>
              <span className="num text-[10px] text-faint">{group.stories.length}</span>
            </div>
            <ul className="space-y-0.5 px-1.5">
              {group.stories.map((story) => (
                <StoryRow
                  key={story.id}
                  story={story}
                  active={story.id === activeStoryId}
                  stat={stats[story.id]}
                  onOpen={() => {
                    void openStory(story.id);
                    onPick?.();
                  }}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/* ----------------------------------------------------------- a conversation */

/**
 * A story's portrait. There is no cover in the schema that any UI writes yet, so
 * the fallback is the real design: the story's own theme as the ground, its
 * initial in that theme's own ink — the same trick the transcript uses for a
 * character with no card image, so a story without a picture still has a face.
 */
function StoryPortrait({ story }: { story: Story }) {
  const cover = COVER[story.theme];
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-border"
      style={{ background: cover.ground }}
      aria-hidden="true"
    >
      {story.cover ? (
        <img src={story.cover} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <span className="font-display text-[15px] leading-none font-semibold" style={{ color: cover.ink }}>
          {story.title.trim().charAt(0).toUpperCase() || '·'}
        </span>
      )}
    </span>
  );
}

function StoryRow({
  story,
  active,
  stat,
  onOpen,
}: {
  story: Story;
  active: boolean;
  stat: { costUsd: number; savedUsd: number; words: number; hitRate: number; requests: number } | undefined;
  onOpen: () => void;
}) {
  return (
    <li>
      <div
        className="group flex items-center gap-2 rounded-md px-1.5 py-1.5"
        style={{
          background: active ? 'var(--accent-soft)' : 'transparent',
          boxShadow: active ? 'inset 2px 0 0 var(--accent)' : undefined,
        }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={onOpen}
          aria-current={active}
        >
          <StoryPortrait story={story} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 truncate font-display text-[13px] leading-tight font-semibold">{story.title}</span>
              {/* A chat is a story, but it is not a story: one card, one prefix,
                  and a name that is the character's rather than a title the
                  writer chose. One word is enough to tell them apart when
                  scanning, and the portrait is already the character's initial. */}
              {story.characterId ? <span className="chip shrink-0">chat</span> : null}
            </span>
            <span className="num mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-faint">
              {stat ? (
                <>
                  <span>{formatTokens(stat.words)}w</span>
                  <span aria-hidden="true">·</span>
                  <span style={{ color: 'var(--accent)' }}>{formatUsd(stat.costUsd)}</span>
                  {stat.requests > 0 ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span style={{ color: stat.hitRate >= 0.7 ? 'var(--cache-hit)' : 'var(--cache-miss)' }}>
                        {formatPercent(stat.hitRate)} hit
                      </span>
                    </>
                  ) : null}
                </>
              ) : (
                <span>{MODELS[story.model].label}</span>
              )}
            </span>
          </span>
        </button>

        <StoryActions story={story} />
      </div>
    </li>
  );
}
