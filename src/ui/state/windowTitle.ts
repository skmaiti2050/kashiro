const APP_NAME = 'Kashiro';
/** Characters of a file name in the window title before it is cut in the middle (F20 item 11). */
const MAX_NAME = 48;
/** An extension worth keeping whole when a name is cut: ".docx", ".md". */
const EXTENSION = /\.[^.\s]{1,8}$/u;

/**
 * `name` cut in the middle to `max` characters (code points, so no character is cut in two), keeping its start
 * and its extension: "Disaster-Recovery-Run…-v2.docx".
 */
export function middleTruncate(name: string, max = MAX_NAME): string {
  const chars = [...name];
  if (chars.length <= max) return name;
  const extension = [...(EXTENSION.exec(name)?.[0] ?? '')];
  const stem = chars.slice(0, chars.length - extension.length);
  const room = max - extension.length - 1; // one for "…"
  const head = Math.ceil((room * 2) / 3);
  return [...stem.slice(0, head), '…', ...stem.slice(stem.length - (room - head)), ...extension].join('');
}

/** The window's title: "{name} — Kashiro" for an opened file; "Kashiro" for a paste, the sample or nothing. */
export function windowTitle(document: { name: string; path: string | null } | null): string {
  return document?.path ? `${middleTruncate(document.name)} — ${APP_NAME}` : APP_NAME;
}
