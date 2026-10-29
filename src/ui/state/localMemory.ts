/**
 * Per-PC conveniences kept in localStorage (the panel's width, the last Settings tab, the theme for the first frame,
 * …): never settings, so storage being off only means each starts at its default.
 */

/** The value stored under `key`, or null when none is; `fallbackOnError` when storage can't be read. */
export function readLocal(key: string, fallbackOnError: string | null = null): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage can be off: the caller's default applies.
    return fallbackOnError;
  }
}

/** Stores `value` under `key`; nothing when storage is off (only the next start's convenience depends on it). */
export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only the next start's convenience depends on it.
  }
}

/** The stored value under `key` when it is one of `allowed`, else `fallback` (none stored, or storage off). */
export function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const saved = readLocal(key);
  return allowed.includes(saved as T) ? (saved as T) : fallback;
}
