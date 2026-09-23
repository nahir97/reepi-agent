/**
 * New chat: pick the prompt, then start talking.
 *
 * The friction this removes is the ordering one. Previously the only way to a
 * conversation with a character was Cast → library → card → `Chat`, and the only
 * way to give that conversation a system prompt was to find it afterwards in a
 * studio dialog and press `Apply to story`. A writer who had just written a prompt
 * for a character had to apply it blind, one screen away from the conversation it
 * was for.
 *
 * Three decisions shape what this dialog *is*:
 *
 * - **It refuses to run when a chat already exists.** A card has at most one
 *   conversation (`stories.character_id` is unique), so `startChatWith` would open
 *   the existing one — and a "new chat" picker over an existing chat is a lie about
 *   what the button does. The dialog closes and opens the conversation instead.
 * - **The greeting is chosen before the chat exists.** A card may carry several
 *   openings — its `first_mes` plus any alternate greetings — and the chosen index
 *   is handed to `startChatWith`, which seeds exactly one into the new transcript.
 *   A card with none opens on an empty page rather than on a line the app invented.
 * - **The prompt is applied after the chat exists, through the ordinary PATCH.**
 *   There is no composite server endpoint and nothing to make atomic: the chat is
 *   created by `startChatWith`, then the chosen template is copied by
 *   `applyTemplate` — the same action the rail's Prompt section uses. One write
 *   path, one meaning of "apply".
 *
 * The consequence of that ordering is stated where it can happen: if the chat is
 * created and the template write then fails, **the chat stays**. Rolling it back
 * would throw away the card's greeting because a prompt could not be written, and
 * the prompt is one action away in the rail. The failure is reported by the
 * existing error toast, and the dialog closes on the chat, not on the error.
 */

import { useState } from 'react';
import { greetingsOf } from '../../../shared/greetings.ts';
import { clip } from '../../../shared/text.ts';
import { BLOCK_LABELS, filledBlocks } from '../../../shared/types.ts';
import { useStore } from '../../store.ts';
import { Avatar } from '../Avatar.tsx';
import { Shell } from './shell.tsx';

export function NewChatDialog({ characterId, fromStoryId }: { characterId: string; fromStoryId?: string }) {
  const bundle = useStore((state) => state.bundle);
  const stories = useStore((state) => state.stories);
  const castLibrary = useStore((state) => state.castLibrary);
  const templates = useStore((state) => state.promptTemplates);
  const startChatWith = useStore((state) => state.startChatWith);
  const openStory = useStore((state) => state.openStory);
  const applyTemplate = useStore((state) => state.applyTemplate);
  const openDialog = useStore((state) => state.openDialog);
  const setPage = useStore((state) => state.setPage);

  const [templateId, setTemplateId] = useState<string>('');
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  /* The card can come from the library the launcher read, or from the open
     bundle (the cast page). One lookup, both hosts. */
  const card =
    castLibrary?.characters.find((character) => character.id === characterId) ??
    bundle?.characters.find((character) => character.id === characterId) ??
    null;

  const existing = stories.find((story) => story.characterId === characterId) ?? null;
  const chosen = templates.find((template) => template.id === templateId) ?? null;

  const close = (): void => openDialog(null);

  if (!card) {
    return (
      <Shell title="New chat" onClose={close}>
        <p className="text-[12.5px] text-faint">
          That card is not in the library any more, so there is nothing to talk to.
        </p>
      </Shell>
    );
  }

  /* One conversation per character, so the honest thing is to open it. */
  if (existing) {
    return (
      <Shell
        title={`Chat with ${card.name}`}
        subtitle="You already have a conversation with this card — a card has one, so this is it."
        onClose={close}
        footer={
          <button type="button" className="btn btn-primary" onClick={close}>
            Close
          </button>
        }
      >
        <p className="text-[12.5px] leading-snug text-dim">
          Open “{existing.title}” to keep writing, or apply a prompt to it from the Prompt section of the story panel.
        </p>
      </Shell>
    );
  }

  const begin = async (): Promise<void> => {
    setBusy(true);
    await startChatWith(characterId, fromStoryId, greetingIndex);
    /* The chat owns the screen either way: it is what the writer asked for, and a
       failure to write the prompt must not strand them in a dialog. */
    close();
    setPage('story');
    if (templateId) {
      const template = templates.find((candidate) => candidate.id === templateId);
      if (template) await applyTemplate(template);
    }
    setBusy(false);
  };

  const blocks = chosen ? filledBlocks(chosen) : [];
  /* The list the index means: blanks dropped, opening first. The server reads the
     same list, so a choice made here names the line that is actually written. */
  const greetings = greetingsOf(card);

  return (
    <Shell
      title={`New chat with ${card.name}`}
      subtitle="Starts the conversation on the greeting you choose. The prompt is copied into this chat, never pointed at."
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void begin()}>
            {busy ? 'Starting…' : chosen ? `Start with “${chosen.name}”` : 'Start chat'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <Avatar name={card.name} src={card.avatar} size="lg" />
        <div className="min-w-0">
          <p className="font-display text-[14px] leading-tight font-semibold">{card.name}</p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-faint">{card.tagline || 'no tagline yet'}</p>
        </div>
      </div>

      {greetings.length > 0 ? (
        <fieldset className="mt-4">
          <legend className="label">Opening</legend>
          <div className="space-y-1">
            {greetings.map((text, index) => (
              <PromptOption
                key={index}
                group="new-chat-greeting"
                name={index === 0 ? 'Opening line' : `Alternate ${index}`}
                blurb={clip(text, 160)}
                blocks={[]}
                chosen={greetingIndex === index}
                onPick={() => setGreetingIndex(index)}
              />
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="mt-4 text-[11px] leading-snug text-faint">
          This card has no opening line, so the chat will start on an empty page. Write the first turn yourself, or add a
          greeting in the card editor first.
        </p>
      )}

      <fieldset className="mt-4">
        <legend className="label">Prompt</legend>
        <div className="space-y-1">
          <PromptOption
            group="new-chat-prompt"
            name="No prompt"
            blurb="Keep the world's own blocks, exactly as the chat is seeded with them."
            blocks={[]}
            chosen={templateId === ''}
            onPick={() => setTemplateId('')}
          />
          {templates.map((template) => (
            <PromptOption
              key={template.id}
              group="new-chat-prompt"
              name={template.name}
              blurb={template.blurb || 'no blurb'}
              blocks={filledBlocks(template).map((block) => BLOCK_LABELS[block])}
              builtin={template.builtin}
              chosen={template.id === templateId}
              onPick={() => setTemplateId(template.id)}
            />
          ))}
        </div>
      </fieldset>

      <p className="mt-3 text-[10.5px] leading-snug text-faint">
        {blocks.length > 0
          ? `Applying this overwrites ${blocks.length} block${blocks.length === 1 ? '' : 's'} in the new chat. Directive blocks sit at the front of the payload, so the chat's first turn pays the miss price once and every turn after it hits.`
          : 'The chat inherits the world it was seeded from — contract, genre, style, bible, scenario and anchored lore — and no turns from it.'}
      </p>
    </Shell>
  );
}

function PromptOption({
  group,
  name,
  blurb,
  blocks,
  builtin,
  chosen,
  onPick,
}: {
  /** Radio group name: two fieldsets on one shell must not share a group. */
  group: string;
  name: string;
  blurb: string;
  blocks: string[];
  builtin?: boolean;
  chosen: boolean;
  onPick: () => void;
}) {
  return (
    <label
      className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5"
      style={{
        borderColor: chosen ? 'var(--accent)' : 'var(--border)',
        background: chosen ? 'var(--accent-soft)' : 'transparent',
      }}
    >
      <input type="radio" name={group} className="sr-only" checked={chosen} onChange={onPick} />
      <span
        aria-hidden="true"
        className="mt-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border"
        style={{ borderColor: chosen ? 'var(--accent)' : 'var(--border-strong)' }}
      >
        {chosen ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} /> : null}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate font-display text-[12.5px] font-semibold">{name}</span>
          {builtin ? <span className="chip shrink-0">built-in</span> : null}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-faint">{blurb}</span>
        {blocks.length > 0 ? (
          <span className="mt-1 block truncate text-[10.5px] text-dim">{blocks.join(' · ')}</span>
        ) : null}
      </span>
    </label>
  );
}
