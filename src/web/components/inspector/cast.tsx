/**
 * Cast: the character cards, and their share of the frozen prefix.
 */

import { formatTokens } from '../../../shared/cost.ts';
import { api } from '../../api.ts';
import { useStore } from '../../store.ts';
import { Avatar } from '../Avatar.tsx';
import { Card, SectionTitle } from '../panel.tsx';
import { IconPen, IconPlus } from '../icons.tsx';

/* -------------------------------------------------------------------- cast */

export function CastTab() {
  const bundle = useStore((state) => state.bundle);
  const refreshBundle = useStore((state) => state.refreshBundle);
  const fail = useStore((state) => state.fail);
  const openDialog = useStore((state) => state.openDialog);

  if (!bundle) return null;
  const total = bundle.characters.reduce((sum, character) => sum + character.tokens, 0);

  return (
    <div>
      <SectionTitle
        title="Cast"
        hint={`${formatTokens(total)} tok total`}
        action={
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.2rem 0.45rem' }}
            onClick={() => {
              void (async () => {
                try {
                  const created = await api.characters.create(bundle.story.id, { name: 'New character' });
                  await refreshBundle({ quiet: true });
                  openDialog({ kind: 'card', card: 'character', id: created.id });
                } catch (error) {
                  fail(error, 'Could not add a character');
                }
              })();
            }}
          >
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
    </div>
  );
}
