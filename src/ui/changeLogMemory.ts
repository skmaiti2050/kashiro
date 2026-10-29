/** Whether the change log was open when the app last closed (F22 item 5): a per-PC convenience, not a setting. */
const STORAGE_KEY = 'kashiro.changeLogOpen';

export function changeLogWasOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Storage can be off: the log then starts closed, as before.
    return false;
  }
}

export function rememberChangeLogOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(open));
  } catch {
    // Only the next start's open or closed log depends on it.
  }
}
