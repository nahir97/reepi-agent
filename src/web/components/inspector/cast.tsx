/**
 * Cast: the character cards, and their share of the frozen prefix.
 *
 * The roster itself — searching it, sorting it, comparing cards side by side —
 * is `CastPage`, which is where a writer goes to build one. This section stays
 * because it answers a different question: what the cast costs, in payload
 * order, beside the other blocks.
 */

import { formatTokens } from '../../../shared/cost.ts';
import { useStore } from '../../store.ts';
import { Avatar } from '../Avatar.tsx';
import { Card, SectionTitle } from '../panel.tsx';
import { IconPen, IconPlus, IconUsers } from '../icons.tsx';

/* -------------------------------------------------------------------- cast */

export function CastTab() {
  const bundle = useStore((state) => state.bundle);
  const createCard = useStore((state) => state.createCard);
  const setPage = useStore((state) => state.setPage);
  const openDialog = useStore((state) => state.openDialog);

  if (!bundle) return null;
  const total = bundle.characters.reduce((sum, character) => sum + character.tokens, 0);

  return (
    <div>
      <SectionTitle
        title="Cast"
        hint={`${formatTokens(total)} tok total`}
        action={
          <button type="button" className="btn btn-ghost" style={{ padding: '0.2rem 0.45rem' }} onClick={() => void createCard('character')}>
            <IconPlus size={11} />
            Add
          </button>
        }
      />

      <p className="mb-2 text-[10.5px] leading-snug text-faint">
        Cast cards sit high in the payload. Adding or reordering one re-prices every token behind it, so it is worth
        batching cast edits into a single sitting.
      </p>

      {bundle.characters.length === 0 ? (
        <p className="text-[12px] text-faint">No one in this story yet.</p>
      ) : null}

      {bundle.characters.map((character) => (
        <Card key={character.id}>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 text-left"
            onClick={() => openDialog({ kind: 'card', card: 'character', id: character.id })}
          >
            <Avatar name={character.name} src={character.avatar} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[13px] font-semibold">{character.name}</span>
              <span className="block truncate text-[11px] text-faint">{character.tagline || 'no tagline'}</span>
            </span>
            <span className="chip">{formatTokens(character.tokens)} tok</span>
            <IconPen size={12} className="text-faint" />
          </button>
        </Card>
      ))}

      {/* The roster is the place to build a cast; this column is for reading what
          it costs. One row, rather than a second copy of the page's controls —
          and it names the *library*, because that is the page a writer with an
          empty cast actually needs. */}
      <button
        type="button"
        className="btn btn-ghost w-full justify-start"
        style={{ padding: '0.3rem 0.45rem' }}
        onClick={() => setPage('characters')}
      >
        <IconUsers size={12} />
        Browse the character library
      </button>
    </div>
  );
}
