import { useEffect } from 'react';
import { THEMES, type ThemeChoice } from './state/readingSettings';

/**
 * The theme on the page (Task F21b item 4): `data-theme="light"` or `"dark"` on <html>, which app.css reads. The
 * choice is saved with the settings, which load asynchronously, so it is also kept in localStorage: main.tsx sets the
 * attribute from there before React renders, and the first frame already has the right colours. A Windows contrast
 * theme (forced colours) overrides both themes.
 */

/** The copy of the theme choice read at start-up, before the settings are loaded. */
const STORAGE_KEY = 'kashiro.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const windowsIsDark = () => window.matchMedia?.(DARK_QUERY).matches ?? false;

/** Puts the theme `choice` stands for on the page: System reads Windows' mode now. */
export function showTheme(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'system' && windowsIsDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** The theme chosen last time, for the first frame; System when none was saved or storage is unavailable. */
export function startupTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(saved as ThemeChoice) ? (saved as ThemeChoice) : 'system';
  } catch {
    // Storage can be off; the settings still apply the theme once they load.
    return 'system';
  }
}

function rememberTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Only the next start's first frame uses it; the saved settings stay the source of truth.
  }
}

/** Shows `choice`, remembers it for the next start, and while it is System follows Windows' mode as it changes. */
export function useTheme(choice: ThemeChoice): void {
  useEffect(() => {
    showTheme(choice);
    rememberTheme(choice);
    if (choice !== 'system') return;
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const follow = () => showTheme('system');
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [choice]);
}
