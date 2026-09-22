/**
 * Block renderers.
 *
 * These three turn rows into the exact lines a block carries. They live here
 * rather than in `composer.ts` because two readers need them — the composer,
 * which builds the payload, and `macros.ts`, which resolves `{{state}}` and
 * `{{threads}}` inside a template. A second copy of "how the cast renders" would
 * be a silent divergence between what a writer previews and what the model reads.
 *
 * Nothing here decides ordering or framing; the composer does that.
 */

import type { Character, Scene, Thread } from '../shared/types.ts';

/** The cast block's card format: name, then whichever fields are set. */
export function renderCast(characters: readonly Character[]): string {
  if (characters.length === 0) return '';
  const cards = characters.map((character) => {
    const lines = [`### ${character.name}`];
    if (character.tagline) lines.push(`*${character.tagline}*`);
    if (character.description) lines.push(character.description);
    if (character.personality) lines.push(`Personality: ${character.personality}`);
    if (character.speech) lines.push(`Speech: ${character.speech}`);
    if (character.scenario) lines.push(`Scene role: ${character.scenario}`);
    return lines.join('\n');
  });
  return cards.join('\n\n');
}

/** Open threads only: the closed ones are history, not instruction. */
export function renderThreads(threads: readonly Thread[]): string {
  const open = threads.filter((thread) => thread.status === 'open');
  if (open.length === 0) return '';
  return `Unresolved threads the narrator is holding:\n${open.map((thread) => `- ${thread.label}`).join('\n')}`;
}

export function renderState(scene: Scene): string {
  if (scene.state.length === 0) return '';
  return scene.state.map((field) => `${field.key}: ${field.value}`).join('\n');
}
