/**
 * Persona: the card the model reads as the writer.
 */

import { formatTokens } from '../../../shared/cost.ts';
import { api } from '../../api.ts';
import { useStore } from '../../store.ts';
import { Avatar } from '../Avatar.tsx';
import { Card, SectionTitle } from '../panel.tsx';
import { IconPlus } from '../icons.tsx';

/* ----------------------------------------------------------------- persona */

export function PersonaTab() {
  const bundle = useStore((state) => state.bundle);
  const refreshBundle = useStore((state) => state.refreshBundle);
  const fail = useStore((state) => state.fail);
  const openDialog = useStore((state) => state.openDialog);

  if (!bundle) return null;

  return (
    <div>
      <SectionTitle
        title="Personas"
        hint={`${bundle.personas.length}`}
        action={
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0.2rem 0.45rem' }}
            onClick={() => {
              void (async () => {
                try {
                  const created = await api.personas.create(bundle.story.id, { name: 'New persona' });
                  await refreshBundle({ quiet: true });
                  openDialog({ kind: 'card', card: 'persona', id: created.id });
                } catch (error) {
                  fail(error, 'Could not add a persona');
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
        Your persona is the one card the model reads as <span className="num">{'{{user}}'}</span>. It sits beside the
        cast, so treat edits here the same way: batch them.
      </p>

      {bundle.personas.map((persona) => (
        <Card key={persona.id}>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 text-left"
            onClick={() => openDialog({ kind: 'card', card: 'persona', id: persona.id })}
          >
            <Avatar name={persona.name} src={persona.avatar} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[13px] font-semibold">{persona.name}</span>
              <span className="block truncate text-[11px] text-faint">
                {bundle.story.personaId === persona.id ? 'active — read as you' : persona.description ? 'your persona' : 'no description yet'}
              </span>
            </span>
            {persona.isDefault ? <span className="chip chip-accent">default</span> : null}
            <span className="chip">{formatTokens(persona.tokens)} tok</span>
          </button>
        </Card>
      ))}
    </div>
  );
}
