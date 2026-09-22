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

/** The vertical spine on a library row, keyed to that story's own theme. */
export const THEME_COVER: Record<Theme, string> = {
  ink: 'linear-gradient(150deg, #d9a44c, #6b4a1f)',
  ember: 'linear-gradient(150deg, #e2893c, #7a2f1c)',
  verdant: 'linear-gradient(150deg, #6cc4a1, #1d4a38)',
  daylight: 'linear-gradient(150deg, #96551a, #d9c3a0)',
};
