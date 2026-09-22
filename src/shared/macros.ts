/**
 * The macro registry.
 *
 * A macro is a `{{name}}` token the writer can put in prompt text, resolved
 * against the *current* story every time a payload is built. Nothing is baked:
 * a contract that says `{{user}}` keeps saying it while the persona underneath
 * changes, which is the whole point — and the reason a macro in a frozen block
 * can re-price the prefix when its value changes.
 *
 * This file is the single source of truth for *which* macros exist and what they
 * are called. `src/server/macros.ts` holds the resolvers, typed as
 * `Record<MacroName, …>`, so a registered macro without a resolver is a compile
 * error rather than a token the model reads literally. The pattern and the token
 * scanner live here too, so the editor's "unknown macro" warning and the
 * composer's expansion can never disagree about what counts as a macro.
 *
 * Deliberately absent, each for a reason that would otherwise be re-litigated:
 *
 * - **No date or time macro.** Anything volatile in the prefix invalidates every
 *   block behind it, and a timestamp does it once a day, forever, silently.
 * - **No `{{model}}`, `{{effort}}`, `{{temperature}}`.** Those are knobs on the
 *   request, not text in the prompt; a story setting that can be read as prose is
 *   a setting the model can be told to obey, which is a different (bad) feature.
 * - **No whole-cast dump.** The cast block already injects every card at full
 *   price, so `{{cast}}` would pay for them twice. `{{castNames}}` is the cheap
 *   version of the same intent.
 * - **No memory or lore recall macro.** That material is already injected
 *   dynamically each turn, in the volatile tail, where it belongs.
 * - **No escape hatch for a literal `{{name}}`.** SillyTavern has none either,
 *   and a half-built one is worse than a documented absence: an unknown name is
 *   left verbatim, so the text survives — it just is not a way to write a *known*
 *   name literally.
 */

/** Display grouping for the reference panel, in the order it renders. */
export const MACRO_GROUPS = ['Identity', 'Cast', 'Persona', 'World', 'Scene'] as const;
export type MacroGroup = (typeof MACRO_GROUPS)[number];

export type MacroDefinition = {
  /** Canonical, lowercase, no braces. Lookup is case-insensitive. */
  name: string;
  label: string;
  group: MacroGroup;
  /** One line for the reference panel: what it resolves to, or why it exists. */
  hint: string;
};

export const MACROS = [
  {
    name: 'char',
    label: 'Character name',
    group: 'Identity',
    hint: "The card this chat is about; in a group story, the cast's first card.",
  },
  {
    name: 'description',
    label: 'Character description',
    group: 'Identity',
    hint: 'The primary card\'s description, exactly as the cast block renders it.',
  },
  {
    name: 'personality',
    label: 'Character personality',
    group: 'Identity',
    hint: 'The primary card\'s personality line.',
  },
  { name: 'speech', label: 'Character speech habits', group: 'Identity', hint: 'The primary card\'s speech note.' },
  {
    name: 'charScenario',
    label: "Character's scene role",
    group: 'Identity',
    hint: "The card's own scenario field. The story's Scenario & world block is {{scenario}}.",
  },
  {
    name: 'castNames',
    label: 'Everyone on stage',
    group: 'Cast',
    hint: 'Comma-joined names, empty when the cast is.',
  },
  {
    name: 'user',
    label: 'Persona name',
    group: 'Persona',
    hint: 'The persona the payload uses as the writer, falling back to "Player".',
  },
  {
    name: 'persona',
    label: 'Persona description',
    group: 'Persona',
    hint: 'The chosen persona\'s description — the persona block, in place.',
  },
  { name: 'title', label: 'Story title', group: 'World', hint: 'The story\'s title.' },
  { name: 'genre', label: 'Genre & tone', group: 'World', hint: 'The Genre & tone block.' },
  { name: 'style', label: 'Prose style', group: 'World', hint: 'The Prose style block.' },
  {
    name: 'scenario',
    label: 'Scenario & world',
    group: 'World',
    hint: 'The Scenario block. A card\'s own scenario is {{charScenario}}.',
  },
  { name: 'bible', label: 'Story bible', group: 'World', hint: 'The Story bible block.' },
  { name: 'exemplars', label: 'Exemplars', group: 'World', hint: 'The Exemplars block.' },
  {
    name: 'synopsis',
    label: 'Rolling synopsis',
    group: 'World',
    hint: 'The summary of everything trimmed out of the transcript. Empty until one exists.',
  },
  { name: 'sceneTitle', label: 'Scene title', group: 'Scene', hint: 'The active scene\'s title.' },
  {
    name: 'state',
    label: 'Scene state',
    group: 'Scene',
    hint: 'The tracked scene facts, one per line, as the Scene state block renders them.',
  },
  {
    name: 'threads',
    label: 'Open threads',
    group: 'Scene',
    hint: 'The unresolved threads the narrator is holding, as a bulleted list.',
  },
  {
    name: 'targetWords',
    label: 'Target words',
    group: 'Scene',
    hint: 'The story\'s target response length, as a bare number.',
  },
] as const satisfies readonly MacroDefinition[];

export type MacroName = (typeof MACROS)[number]['name'];

/**
 * The token pattern, as a source string rather than a compiled literal.
 *
 * A single module-level `/g` regex is stateful (`lastIndex` survives a `test`),
 * and two callers — the composer's expansion and the editor's checker — would
 * interleave on it. Every caller compiles its own instead; there is still exactly
 * one definition of what a token looks like.
 */
export const MACRO_SOURCE = '\\{\\{\\s*([A-Za-z0-9_-]+)\\s*\\}\\}';

/** A fresh, global, case-insensitive matcher for `{{name}}` tokens. */
export function macroPattern(): RegExp {
  return new RegExp(MACRO_SOURCE, 'gi');
}

/**
 * The lookup is keyed by *lowercased* name, not by the canonical spelling: the
 * parser lowercases what the writer typed so that `{{USER}}` and `{{User}}` both
 * resolve, which means a key like `charScenario` would otherwise only be reachable
 * in its exact casing. The registry stays the readable camelCase spelling; only the
 * index is flattened.
 */
const BY_NAME = new Map<string, (typeof MACROS)[number]>(
  MACROS.map((macro) => [macro.name.toLowerCase(), macro]),
);

/**
 * Case-insensitive lookup. `null` means "not a macro we know", which is not an
 * error — the token is left exactly as typed.
 *
 * The return type is the registry's own element type rather than a restated
 * interface, so the compiler knows the name is one of `MacroName` and the server's
 * resolver map can be indexed with it without a cast.
 */
export function canonicalMacro(name: string): (typeof MACROS)[number] | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

export type MacroToken = {
  /** The text as the writer typed it, braces and inner spacing included. */
  raw: string;
  /** Canonical name for a known macro; the lowercased token otherwise. */
  name: string;
  known: boolean;
};

/**
 * Every `{{…}}` token in `text`, in order, duplicates included.
 *
 * Unknown names are returned rather than skipped: the UI needs to flag them, and
 * the composer needs to know they were left alone.
 */
export function macroTokens(text: string): MacroToken[] {
  const tokens: MacroToken[] = [];
  for (const match of text.matchAll(macroPattern())) {
    const raw = match[0];
    const typed = match[1] ?? '';
    const definition = canonicalMacro(typed);
    tokens.push({
      raw,
      name: definition ? definition.name : typed.trim().toLowerCase(),
      known: definition !== null,
    });
  }
  return tokens;
}
