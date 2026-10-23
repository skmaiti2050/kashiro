/**
 * The app's own Tauri commands, read from the Rust sources (Task S8b): the `generate_handler!` list in
 * src-tauri/src/lib.rs and the AppManifest command list in src-tauri/build.rs. The two must match, so that
 * every command needs an explicit capability grant (tauri-build: no manifest means any local webview may
 * call any app command).
 */
import { compareText } from './licences';

/** The handler list: `tauri::generate_handler![overwrite_with_backup, sessions::session_save]`. */
const HANDLER_LIST = /generate_handler!\[([^\]]*)\]/;
/** The manifest list: `AppManifest::new().commands(&["overwrite_with_backup", "session_save"])`. */
const MANIFEST_LIST = /\.commands\(&\[([^\]]*)\]\)/;
/** One quoted command name in the manifest list. */
const QUOTED_NAME = /"([^"]+)"/g;

const sorted = (names: string[]) => [...names].sort(compareText);

/** The command names in `generate_handler!`, without module paths, sorted. */
export function handlerCommands(libRs: string): string[] {
  const list = HANDLER_LIST.exec(libRs);
  if (!list) throw new Error('No generate_handler! list found in src-tauri/src/lib.rs.');
  return sorted(list[1].split(',').map((entry) => entry.trim().split('::').pop()!).filter(Boolean));
}

/** The command names the app manifest declares in build.rs, sorted. */
export function manifestCommands(buildRs: string): string[] {
  const list = MANIFEST_LIST.exec(buildRs);
  if (!list) throw new Error('No AppManifest commands list found in src-tauri/build.rs.');
  return sorted([...list[1].matchAll(QUOTED_NAME)].map((m) => m[1]));
}

/** The permission tauri-build generates for an app command: "session_save" -> "allow-session-save". */
export const allowPermission = (command: string): string => `allow-${command.replace(/_/g, '-')}`;

/**
 * One frontend call and its first argument, up to a comma or `)`: `invoke<string>('session_load', …)`,
 * `invoke("llm_stop")`, `invoke<Array<string>>(name)`. The type argument holds no parentheses.
 */
const INVOKE_CALL = /\binvoke\s*(?:<[^()]*?>)?\(\s*([^,)]*)/g;
/** A plain string literal command name in any quote style: 'llm_start', "llm_start", `llm_start` (no `${`). */
const LITERAL_NAME = /^(['"`])([A-Za-z0-9_]+)\1$/;

/** invoke imported under another name: `import { invoke as call } from '@tauri-apps/api/core'`. */
const RENAMED_INVOKE = /\binvoke\s+as\s+[A-Za-z_$][\w$]*/;
/** invoke kept under another name: `const call = invoke;` (not `fn === invoke`, not a call `= invoke(`). */
const ASSIGNED_INVOKE = /(?<![=!<>])=\s*invoke\b(?!\s*[<(])/;
/** invoke destructured under another name: `const { invoke: call } = …`. */
const DESTRUCTURED_INVOKE = /\binvoke\s*:\s*[A-Za-z_$][\w$]*/;

/**
 * `source` with its `//` and `/* *\/` comments blanked (newlines kept), so a call in a comment is not counted
 * and a comment mentioning `invoke(command)` does not fail the check. Quotes are followed so `'http://…'` is
 * not a comment; a backslash skips the next character (escapes in strings and regular expressions).
 */
export function withoutComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      out += source.slice(i, i + 2);
      i++;
      continue;
    }
    if (quote) {
      // A ' or " string ends at the line's end anyway: a stray apostrophe can't swallow the next lines.
      if (c === quote || (c === '\n' && quote !== '`')) quote = null;
      out += c;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    const stop = commentEnd(source, i);
    if (stop === null) {
      out += c;
      continue;
    }
    out += source.slice(i, stop).replace(/[^\n]/g, ' ');
    i = stop - 1;
  }
  return out;
}

/** Where the comment starting at `i` ends (end-exclusive; a line comment keeps its newline), or null when none starts there. */
function commentEnd(source: string, i: number): number | null {
  if (source[i] !== '/') return null;
  if (source[i + 1] === '/') {
    const newline = source.indexOf('\n', i);
    return newline === -1 ? source.length : newline;
  }
  if (source[i + 1] === '*') {
    const close = source.indexOf('*/', i + 2);
    return close === -1 ? source.length : close + 2;
  }
  return null;
}

/**
 * The distinct command names the frontend sources invoke, sorted. Comments are ignored. Throws on a name that
 * is not a literal (`invoke(command)`, `` invoke(`llm_${verb}`) ``) and on invoke kept under another name
 * (imported, assigned or destructured): such a call could reach a command this check never sees.
 */
export function invokedCommands(sources: string[]): string[] {
  const names = sources.flatMap((original) => {
    const source = withoutComments(original);
    const renamed = RENAMED_INVOKE.exec(source);
    if (renamed) throw new Error(`Import invoke under its own name, so the command check can see each call: ${renamed[0]}`);
    const alias = ASSIGNED_INVOKE.exec(source) ?? DESTRUCTURED_INVOKE.exec(source);
    if (alias) throw new Error(`Use invoke under its own name, so the command check can see each call: ${alias[0]}`);
    return [...source.matchAll(INVOKE_CALL)].map((m) => {
      const argument = m[1].trim();
      const literal = LITERAL_NAME.exec(argument);
      if (!literal) throw new Error(`A Tauri command name must be a string literal: invoke(${argument}`);
      return literal[2];
    });
  });
  return sorted([...new Set(names)]);
}
