/**
 * The story's own record: the cost ledger, and the full editor for a character
 * or a persona.
 *
 * Both are things a writer reaches for deliberately, not things that should be
 * on screen while they are writing. They live in dialogs — the ledger because it
 * is an instrument, and the editor because a card with eight fields and a
 * portrait deserves a real page rather than a column in a sidebar.
 */

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { formatTokens } from '../../shared/cost.ts';
import type { Character, Persona } from '../../shared/types.ts';
import { estimateTokens } from '../../shared/tokens.ts';
import { api, fileToBase64 } from '../api.ts';
import { useStore } from '../store.ts';
import type { CardKind } from '../store.ts';
import { Avatar } from './Avatar.tsx';
import { Insights } from './Insights.tsx';
import { Shell } from './modals.tsx';
import { IconAlert, IconCheck, IconTrash, IconUpload } from './icons.tsx';

/* ------------------------------------------------------------------ ledger */

export function InsightsDialog() {
  const openDialog = useStore((state) => state.openDialog);
  return (
    <Shell
      title="Cost & cache"
      subtitle="What this story has spent, what the cache saved, and what the next turn will cost."
      onClose={() => openDialog(null)}
      wide
    >
      <Insights />
    </Shell>
  );
}

/* ------------------------------------------------------------------ avatar */

/**
 * Portrait control.
 *
 * Images are stored inline as data URLs in SQLite rather than on disk, so a
 * story export is still a single self-contained file. The cost is that they
 * travel in the bundle: `MAX` keeps a runaway camera roll from bloating the
 * database, and the writer is told why rather than having their upload silently
 * shrink.
 */
const MAX_AVATAR_BYTES = 512 * 1024;

function AvatarField({
  name,
  value,
  onPick,
}: {
  name: string;
  value: string | null;
  onPick: (next: string | null) => void;
}) {
  const toast = useStore((state) => state.toast);
  const input = useRef<HTMLInputElement | null>(null);

  const choose = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change.
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ kind: 'error', title: 'That is not an image', detail: 'Use a PNG, JPEG or WebP file.' });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast({
        kind: 'error',
        title: 'Image too large',
        detail: `Portraits are stored inside the story, so they are capped at ${Math.round(MAX_AVATAR_BYTES / 1024)} KB. This one is ${Math.round(file.size / 1024)} KB — crop or resize it first.`,
      });
      return;
    }

    try {
      onPick(await fileToBase64(file));
    } catch {
      toast({ kind: 'error', title: 'Could not read that file' });
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} src={value} size="lg" />
      <div className="min-w-0">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn" style={{ padding: '0.3rem 0.55rem' }} onClick={() => input.current?.click()}>
            <IconUpload size={12} />
            {value ? 'Replace portrait' : 'Add a portrait'}
          </button>
          {value ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0.3rem 0.55rem' }}
              onClick={() => onPick(null)}
            >
              Remove
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-[10.5px] leading-snug text-faint">
          Shown beside their turns. Without one, initials are used. Stored inside the story, so keep it under{' '}
          {Math.round(MAX_AVATAR_BYTES / 1024)} KB.
        </p>
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(event) => void choose(event)} />
    </div>
  );
}

/* ------------------------------------------------------------ shared fields */

function Field({
  label,
  hint,
  value,
  rows,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string;
  rows: number;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;

  useEffect(() => setDraft(value), [value]);

  return (
    <label className="block">
      <span className="label">{label}</span>
      <textarea
        className="field resize-y"
        rows={rows}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => dirty && onCommit(draft)}
      />
      <span className="mt-0.5 flex items-center gap-2 text-[10.5px] text-faint">
        {hint ? <span className="min-w-0 flex-1">{hint}</span> : <span className="flex-1" />}
        <span className="num shrink-0">{estimateTokens(draft)} tok</span>
        {dirty ? (
          <button
            type="button"
            className="btn btn-primary shrink-0"
            style={{ padding: '0.15rem 0.4rem', fontSize: 10.5 }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onCommit(draft)}
          >
            <IconCheck size={10} />
            Save
          </button>
        ) : null}
      </span>
    </label>
  );
}

function CharacterEditor({ character }: { character: Character }) {
  const stories = useStore((state) => state.stories);
  const loadStories = useStore((state) => state.loadStories);
  const refreshBundle = useStore((state) => state.refreshBundle);
  const fail = useStore((state) => state.fail);
  const toast = useStore((state) => state.toast);
  const openDialog = useStore((state) => state.openDialog);

  const save = async (patch: Partial<Character>): Promise<void> => {
    try {
      await api.characters.update(character.id, patch);
      await refreshBundle({ quiet: true });
    } catch (error) {
      fail(error, 'Could not save the card');
    }
  };

  const remove = (): void => {
    /* A chat is deleted with the card it borrows (the database cascades), so the
       confirm has to say so — by name, because "your chat with Cantarella" is
       something a writer recognises and "any related chats" is not. */
    const chats = stories.filter((story) => story.characterId === character.id);
    openDialog({
      kind: 'confirm',
      title: `Delete ${character.name}?`,
      body:
        chats.length > 0
          ? `The card leaves the payload and the cast list, and the chat with them goes with it: ${chats
              .map((chat) => `“${chat.title}”`)
              .join(', ')}. Their turns in this story's transcript stay where they are.`
          : 'The card leaves the payload and the cast list. Their turns in the transcript stay where they are.',
      confirmLabel: 'Delete character',
      danger: true,
      run: () => {
        void (async () => {
          try {
            const result = await api.characters.remove(character.id);
            await refreshBundle({ quiet: true });
            await loadStories().catch(() => undefined);
            toast({
              kind: 'ok',
              title: 'Character deleted',
              ...(result.chats.length > 0
                ? { detail: `Also removed ${result.chats.length} chat${result.chats.length === 1 ? '' : 's'}: ${result.chats.join(', ')}` }
                : {}),
            });
          } catch (error) {
            fail(error, 'Could not delete the character');
          }
        })();
      },
    });
  };

  return (
    <>
      <div className="space-y-3.5">
        <AvatarField name={character.name} value={character.avatar} onPick={(avatar) => void save({ avatar })} />

        <label className="block">
          <span className="label">Name</span>
          <input
            className="field"
            defaultValue={character.name}
            onBlur={(event) => event.target.value !== character.name && void save({ name: event.target.value })}
          />
        </label>

        <label className="block">
          <span className="label">Tagline</span>
          <input
            className="field"
            defaultValue={character.tagline}
            placeholder="One line. Who are they, at a glance?"
            onBlur={(event) => event.target.value !== character.tagline && void save({ tagline: event.target.value })}
          />
        </label>

        <Field
          label="Description"
          value={character.description}
          rows={3}
          hint="Appearance, manner, situation."
          onCommit={(description) => void save({ description })}
        />
        <Field
          label="Personality"
          value={character.personality}
          rows={3}
          hint="How they behave under pressure."
          onCommit={(personality) => void save({ personality })}
        />
        <Field
          label="Speech habits"
          value={character.speech}
          rows={3}
          hint="Injected verbatim. This is what makes their dialogue sound like them rather than like the narrator."
          onCommit={(speech) => void save({ speech })}
        />
        <Field
          label="Scenario"
          value={character.scenario}
          rows={2}
          hint="What they want in this story, specifically."
          onCommit={(scenario) => void save({ scenario })}
        />
        <Field
          label="Example dialogue"
          value={character.exampleDialogue}
          rows={6}
          hint="One exchange per line group. The strongest signal for voice there is."
          onCommit={(exampleDialogue) => void save({ exampleDialogue })}
        />
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
        <span className="num text-[11px] text-faint">{formatTokens(character.tokens)} tokens in the prefix</span>
        <button type="button" className="btn btn-danger ml-auto" onClick={remove}>
          <IconTrash size={12} />
          Delete
        </button>
      </div>
    </>
  );
}

function PersonaEditor({ persona }: { persona: Persona }) {
  const bundle = useStore((state) => state.bundle);
  const refreshBundle = useStore((state) => state.refreshBundle);
  const fail = useStore((state) => state.fail);
  const updateStory = useStore((state) => state.updateStory);
  const toast = useStore((state) => state.toast);
  const openDialog = useStore((state) => state.openDialog);
  const active = bundle?.story.personaId === persona.id;

  const save = async (patch: Partial<Persona>): Promise<void> => {
    try {
      await api.personas.update(persona.id, patch);
      await refreshBundle({ quiet: true });
    } catch (error) {
      fail(error, 'Could not save the persona');
    }
  };

  return (
    <>
      <div className="space-y-3.5">
        <AvatarField name={persona.name} value={persona.avatar} onPick={(avatar) => void save({ avatar })} />

        <label className="block">
          <span className="label">Name</span>
          <input
            className="field"
            defaultValue={persona.name}
            onBlur={(event) => event.target.value !== persona.name && void save({ name: event.target.value })}
          />
        </label>

        <Field
          label="Description"
          value={persona.description}
          rows={8}
          hint="The model reads this as you. Write it in second person — who you are, what you look like, what you want here."
          onCommit={(description) => void save({ description })}
        />

        <p className="flex gap-2 text-[11.5px] leading-snug text-dim">
          <span className="mt-px shrink-0 text-accent">
            <IconAlert size={12} />
          </span>
          <span>
            A persona sits beside the cast, high in the payload. Editing it re-prices every token behind it, so it is
            worth getting right in one sitting rather than adjusting every turn.
          </span>
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="num text-[11px] text-faint">{formatTokens(persona.tokens)} tokens</span>
        {active ? (
          <span className="chip chip-hit">active — the model reads this as you</span>
        ) : (
          <button type="button" className="btn" onClick={() => void updateStory({ personaId: persona.id })}>
            Make active
          </button>
        )}
        <button
          type="button"
          className="btn btn-danger ml-auto"
          onClick={() =>
            openDialog({
              kind: 'confirm',
              title: `Delete ${persona.name}?`,
              body: 'The persona leaves the story. Turns already written as them stay in the transcript.',
              confirmLabel: 'Delete persona',
              danger: true,
              run: () => {
                void (async () => {
                  try {
                    await api.personas.remove(persona.id);
                    await refreshBundle({ quiet: true });
                    toast({ kind: 'ok', title: 'Persona deleted' });
                  } catch (error) {
                    fail(error, 'Could not delete the persona');
                  }
                })();
              },
            })
          }
        >
          <IconTrash size={12} />
          Delete
        </button>
      </div>
    </>
  );
}

/**
 * The card editor. Opened from the cast page, from the inspector's cast list, or
 * from the nav sheet, and it closes back to whatever was underneath — which now
 * needs no bookkeeping at all: the cast page is a page, so it is still there.
 */
export function CardEditorDialog({ kind, id }: { kind: CardKind; id: string }) {
  const bundle = useStore((state) => state.bundle);
  const openDialog = useStore((state) => state.openDialog);

  const character = kind === 'character' ? bundle?.characters.find((item) => item.id === id) : undefined;
  const persona = kind === 'persona' ? bundle?.personas.find((item) => item.id === id) : undefined;
  const name = character?.name ?? persona?.name ?? 'Card';

  // The row can disappear underneath us — a delete, or a story switch.
  if (!character && !persona) return null;

  return (
    <Shell
      title={name}
      subtitle={
        kind === 'character'
          ? `A cast card. ${formatTokens(character?.tokens ?? 0)} tokens, paid once and then cached.`
          : `Your persona. ${formatTokens(persona?.tokens ?? 0)} tokens, paid once and then cached.`
      }
      onClose={() => openDialog(null)}
      wide
    >
      {character ? <CharacterEditor character={character} /> : null}
      {persona ? <PersonaEditor persona={persona} /> : null}
    </Shell>
  );
}
