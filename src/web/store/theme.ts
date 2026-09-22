/**
 * Theme persistence.
 *
 * A theme has to be applied to the document, not just held in state, and it has
 * to be read back *before first paint* — `index.html` reads the same
 * `localStorage` key inline so a dark-preferring writer never sees a flash of
 * light parchment. That two-place read is why the key and the guard live in one
 * module rather than being scattered.
 */

import type { Theme } from '../../shared/types.ts';

const THEME_KEY = 'reepi.theme';
const THEMES: readonly Theme[] = ['ink', 'ember', 'verdant', 'daylight'];

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Reads the same key `index.html` reads pre-paint, so there is never a flash. */
export function storedTheme(): Theme {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (isTheme(raw)) return raw;
  } catch {
    /* private mode */
  }
  return 'ink';
}

export function applyTheme(theme: Theme, manual: boolean): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (manual) root.dataset.themeSource = 'manual';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
}

export function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode */
  }
}
