/**
 * Theme presentation.
 *
 * The swatch gradients were copied between the library rail and the navigation
 * sheet, which meant a theme could look one way in one place and another way in
 * the other. They live here once, next to the list order, so every picker in the
 * app shows the same thing.
 *
 * The gradients are literals rather than `var(--accent)` because a swatch's job is
 * to preview a theme you are *not* currently in — reading the live custom property
 * would make all four swatches look identical.
 */

import type { Theme } from '../shared/types.ts';

export const THEME_ORDER: readonly Theme[] = ['ink', 'ember', 'verdant', 'daylight'];

export const THEME_LABEL: Record<Theme, string> = {
  ink: 'Ink',
  ember: 'Ember',
  verdant: 'Verdant',
  daylight: 'Daylight',
};

/** Background-to-accent gradient, so a swatch reads as the paper it produces. */
export const THEME_DOT: Record<Theme, string> = {
  ink: 'linear-gradient(90deg, #14100e, #d9a44c)',
  ember: 'linear-gradient(90deg, #1a100c, #e2893c)',
  verdant: 'linear-gradient(90deg, #0d1512, #6cc4a1)',
  daylight: 'linear-gradient(90deg, #f6f1e7, #96551a)',
};

/**
 * A story's portrait: the ground it is drawn on, and the ink that reads on it.
 *
 * Both are literals rather than `var(--accent-ink)`/`var(--text)`, for the same
 * reason the swatch gradients are: the portrait shows a theme the writer may not
 * be *in*. A story keeps the theme it was written under, so a `daylight` story
 * listed while the studio sits in `ink` needs ink that reads on parchment — a
 * live custom property would have supplied near-white on near-white.
 *
 * One entry, two values, so the pair cannot drift apart in two call sites the
 * way two parallel tables would.
 */
export const THEME_COVER: Record<Theme, { ground: string; ink: string }> = {
  ink: { ground: 'linear-gradient(150deg, #d9a44c, #6b4a1f)', ink: '#1b1206' },
  ember: { ground: 'linear-gradient(150deg, #e2893c, #7a2f1c)', ink: '#1e0f04' },
  verdant: { ground: 'linear-gradient(150deg, #6cc4a1, #1d4a38)', ink: '#05130d' },
  daylight: { ground: 'linear-gradient(150deg, #96551a, #d9c3a0)', ink: '#fdf8ef' },
};
