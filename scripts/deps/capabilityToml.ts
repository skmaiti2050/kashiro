/**
 * Reads a Tauri capability written in TOML, for the permissions check (Task S8). Only the plain subset a
 * capability needs is read: strings, booleans, arrays of strings and a [remote] table. Anything else
 * throws, so that the check never reads less than the file grants.
 */

/** A blank line or a comment line: "# The main window". */
const SKIPPED_LINE = /^\s*(#.*)?$/;
/** The one table a capability has: "[remote]". */
const REMOTE_TABLE = /^\s*\[remote\]\s*$/;
/** "windows = [", "identifier = \"default\"" */
const KEY_VALUE = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.*?)\s*$/;
/** One double-quoted string with escapes: "core:default". */
const QUOTED = /"((?:[^"\\]|\\.)*)"/g;
/** What may be left of an array of strings once the strings are taken out: commas and spaces. */
const ARRAY_SEPARATORS = /^[\s,]*$/;

function unsupported(text: string): Error {
  return new Error(
    `Cannot read capability TOML line "${text}": only strings, booleans and arrays of strings are supported; write this capability as JSON.`,
  );
}

function parseValue(raw: string, text: string): unknown {
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (raw.startsWith('"')) {
    const strings = [...raw.matchAll(QUOTED)];
    if (strings.length !== 1 || strings[0][0] !== raw) throw unsupported(text);
    return JSON.parse(raw) as string;
  }
  if (!raw.startsWith('[') || !raw.endsWith(']')) throw unsupported(text);
  const inside = raw.slice(1, -1);
  if (!ARRAY_SEPARATORS.test(inside.replace(QUOTED, ''))) throw unsupported(text);
  return [...inside.matchAll(QUOTED)].map((m) => JSON.parse(m[0]) as string);
}

/** The capability as the same object its JSON form would give. */
export function parseCapabilityToml(toml: string): Record<string, unknown> {
  const capability: Record<string, unknown> = {};
  let table = capability;
  const lines = toml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SKIPPED_LINE.test(line)) continue;
    if (REMOTE_TABLE.test(line)) {
      table = {};
      capability.remote = table;
      continue;
    }
    const match = KEY_VALUE.exec(line);
    if (!match) throw unsupported(line.trim());
    let raw = match[2];
    let text = line.trim();
    // An array over several lines runs to the line with its closing bracket.
    while (raw.startsWith('[') && !raw.includes(']') && i + 1 < lines.length) {
      raw += ` ${lines[++i].trim()}`;
      text += ` ${lines[i].trim()}`;
    }
    table[match[1]] = parseValue(raw, text);
  }
  return capability;
}
