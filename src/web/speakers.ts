/**
 * Who is speaking, and what they look like.
 *
 * A message row carries only a `role` and an optional `speaker` string, so the
 * avatar has to be resolved against the story's own cast. Doing it here rather
 * than inside the bubble keeps the lookup out of a component that renders once
 * per turn.
 */

import type { Message } from '../shared/types.ts';
import type { StoryBundle } from '../shared/api.ts';

export type Speaker = {
  name: string;
  avatar: string | null;
  /** `user` turns align right; everything else aligns left. */
  mine: boolean;
};

/** The active persona, or the first one, or a nameless stand-in. */
export function activePersona(bundle: StoryBundle | null) {
  if (!bundle) return null;
  return bundle.personas.find((persona) => persona.id === bundle.story.personaId) ?? bundle.personas[0] ?? null;
}

export function resolveSpeaker(bundle: StoryBundle | null, message: Message): Speaker {
  if (message.role === 'user') {
    const persona = activePersona(bundle);
    return { name: message.speaker ?? persona?.name ?? 'You', avatar: persona?.avatar ?? null, mine: true };
  }

  // An assistant turn attributed to a named character borrows that card's
  // portrait; the narrator has none and falls back to initials.
  const named = message.speaker ? bundle?.characters.find((character) => character.name === message.speaker) : undefined;

  return {
    name: message.speaker ?? 'Narrator',
    avatar: named?.avatar ?? null,
    mine: false,
  };
}
