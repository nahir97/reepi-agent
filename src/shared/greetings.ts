/**
 * Character greetings — the lines a card opens a chat with.
 *
 * A greeting is card data, so it lives in `Character.meta` beside the other
 * fields the card format owns and `characters` has no column for: `first_mes`
 * for the opening line, `alternate_greetings` for the rest. This module is the
 * single reader and writer of those two keys — the server seeds a chat from it,
 * the editor authors through it, and export folds it back onto a card — so the
 * two slots cannot drift apart between call sites.
 *
 * The split between `greetingSlotsOf` (raw) and `greetingsOf` (usable) is
 * deliberate and load-bearing:
 *
 * - **Slots** preserve an empty row, because the editor is where a writer is
 *   mid-sentence and a blank field must survive a save. Key order is the card's:
 *   opening first, then alternates.
 * - **Greetings** drops blank slots, because a chat cannot open on nothing and a
 *   picker with an empty option is a lie. It is also the list an index refers
 *   to, so the editor's slot indices are *not* the wire indices.
 *
 * Nothing here expands macros. A greeting's macros are resolved once, when it is
 * written into a chat's transcript — see `src/server/chats.ts` and
 * `.agents/notes/implemented/architecture/2026-09-22-transcript-single-message.md`.
 */

import type { Character } from './types.ts';

/** The card fields a greeting reads; only `meta` is touched. */
type Carded = Pick<Character, 'meta'>;

/** The two `meta` keys the SillyTavern card format gives greetings. */
const OPENING_KEY = 'first_mes';
const ALTERNATES_KEY = 'alternate_greetings';

/** Raw slots as stored: the opening line, then every alternate in card order. */
export type GreetingSlots = { opening: string; alternates: string[] };

/** A non-blank string, else `''`. Whitespace-only is not a greeting. */
function metaText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '';
}

/** The opening line, or `''` when the card has none. */
export function greetingOf(character: Carded): string {
  return metaText(character.meta[OPENING_KEY]);
}

/**
 * Every stored slot, blanks included. This is what the editor reads and writes:
 * an alternate the writer has added but not yet typed survives the round trip.
 */
export function greetingSlotsOf(character: Carded): GreetingSlots {
  const raw = character.meta[ALTERNATES_KEY];
  return {
    opening: greetingOf(character),
    alternates: Array.isArray(raw) ? raw.map(metaText) : [],
  };
}

/**
 * The greetings a writer can actually start from, blank slots dropped, opening
 * first. An index into this list is what `startChat` seeds from, so it is the
 * only list the picker and the server may enumerate.
 */
export function greetingsOf(character: Carded): string[] {
  const { opening, alternates } = greetingSlotsOf(character);
  return [opening, ...alternates].filter((line) => line.trim().length > 0);
}

/** The alternate openings only, blank slots dropped. */
export function alternateGreetingsOf(character: Carded): string[] {
  return greetingSlotsOf(character).alternates.filter((line) => line.trim().length > 0);
}

/**
 * A `meta` patch that sets the opening line and nothing else.
 *
 * Deliberately a single key: `characters.update` merges a `meta` patch, so two
 * edits that touch different greeting keys compose instead of one clobbering the
 * other. Sending the whole blob back is what makes a slow save lose a fast one.
 */
export function withOpening(opening: string): Record<string, unknown> {
  return { [OPENING_KEY]: opening };
}

/** A `meta` patch that sets the alternate list and nothing else. */
export function withAlternates(alternates: string[]): Record<string, unknown> {
  return { [ALTERNATES_KEY]: alternates };
}
