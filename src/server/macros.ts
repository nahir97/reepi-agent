/**
 * Macro resolution.
 *
 * The other half of `shared/macros.ts`: that file says which macros exist, this
 * one says what each means for a given story. The two are tied together by the
 * type of `RESOLVERS` — a registered macro with no resolver is a compile error —
 * so the reference panel in the editor cannot advertise something the payload
 * would not do.
 *
 * Resolution happens when a payload is built, never on write. A template or a
 * contract keeps its `{{user}}` and re-resolves against whatever the story is
 * now, which is what makes a preset reusable and what makes a macro in a frozen
 * block a cache decision the writer is warned about rather than a surprise.
 *
 * The context is assembled through `castOf` and `resolvePersona`, the same two
 * helpers the payload uses, so a chat's `{{char}}` is the card it borrows and its
 * `{{user}}` is the borrowed pool's persona — the model can never be told it is
 * someone the transcript does not agree with.
 */

import { MACROS, canonicalMacro, macroPattern } from '../shared/macros.ts';
import type { MacroName } from '../shared/macros.ts';
import type { Character, Persona, Scene, Story, Thread } from '../shared/types.ts';
import type { MacroInfo } from '../shared/api.ts';
import { castOf, resolvePersona } from './store/index.ts';
import { renderState, renderThreads } from './render.ts';

export type MacroContext = {
  story: Story;
  /** The active scene, or null before one exists. */
  scene: Scene | null;
  threads: Thread[];
  cast: Character[];
  /** The primary card: a chat's own, else the cast's first. Null on a bare story. */
  character: Character | null;
  persona: Persona | null;
};

export function macroContextOf(story: Story, scene: Scene | null, threads: Thread[]): MacroContext {
  const cast = castOf(story);
  return {
    story,
    scene,
    threads,
    cast,
    character: cast[0] ?? null,
    persona: resolvePersona(story),
  };
}

/**
 * What each macro means. Exhaustive by type: adding a name to the registry
 * without a resolver here fails to compile, which is the only arrangement in
 * which the two files cannot drift.
 */
const RESOLVERS: Record<MacroName, (ctx: MacroContext) => string> = {
  char: ({ character }) => character?.name ?? '',
  description: ({ character }) => character?.description ?? '',
  personality: ({ character }) => character?.personality ?? '',
  speech: ({ character }) => character?.speech ?? '',
  charScenario: ({ character }) => character?.scenario ?? '',
  castNames: ({ cast }) =>
    cast
      .map((member) => member.name.trim())
      .filter(Boolean)
      .join(', '),
  user: ({ persona }) => persona?.name ?? 'Player',
  persona: ({ persona }) => persona?.description ?? '',
  title: ({ story }) => story.title,
  genre: ({ story }) => story.genre,
  style: ({ story }) => story.style,
  scenario: ({ story }) => story.scenario,
  bible: ({ story }) => story.bible,
  exemplars: ({ story }) => story.exemplars,
  synopsis: ({ story }) => story.synopsis,
  sceneTitle: ({ scene }) => scene?.title ?? '',
  state: ({ scene }) => (scene ? renderState(scene) : ''),
  threads: ({ threads }) => renderThreads(threads),
  targetWords: ({ story }) => String(story.targetWords),
};

export type Expansion = {
  text: string;
  /** Canonical names expanded, in first-appearance order, duplicates collapsed. */
  macros: MacroName[];
};

/**
 * Resolve one macro.
 *
 * The map is exhaustive by type, so a miss is impossible; the guard exists so a
 * future registry edit that slips past the compiler degrades to "unknown macro"
 * rather than throwing mid-turn.
 */
function resolveMacro(name: MacroName, ctx: MacroContext): string | null {
  const resolver = RESOLVERS[name];
  return resolver ? resolver(ctx) : null;
}

/**
 * Replace every known `{{macro}}` in `text`.
 *
 * Three rules, all deliberate:
 *
 * - **One pass, no recursion.** A substitute's own text is never rescanned, so a
 *   character description that literally contains `{{char}}` cannot loop and
 *   cannot expand into something the writer did not write.
 * - **Unknown names are left verbatim.** Predictable, visible in the inspector,
 *   and flagged in the editor — silently deleting them would look like the
 *   template worked.
 * - **Empty values become empty strings.** A missing persona description removes
 *   the placeholder rather than leaving the braces behind.
 */
export function expandMacros(text: string, ctx: MacroContext): Expansion {
  if (!text.includes('{{')) return { text, macros: [] };

  const expanded: MacroName[] = [];
  const output = text.replace(macroPattern(), (raw: string, typed: string) => {
    const definition = canonicalMacro(typed);
    if (!definition) return raw;
    const value = resolveMacro(definition.name, ctx);
    if (value === null) return raw;
    if (!expanded.includes(definition.name)) expanded.push(definition.name);
    return value;
  });

  return { text: output, macros: expanded };
}

/**
 * The reference panel's rows, resolved against a story when there is one.
 *
 * `value: null` is not "empty" — it means nothing was resolvable, and the UI
 * shows the name and the hint without pretending a value exists.
 */
export function macroCatalogue(ctx: MacroContext | null): MacroInfo[] {
  return MACROS.map((macro) => ({
    name: macro.name,
    label: macro.label,
    group: macro.group,
    hint: macro.hint,
    value: ctx ? (resolveMacro(macro.name, ctx) ?? '') : null,
  }));
}
