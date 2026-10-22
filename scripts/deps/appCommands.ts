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

/** One frontend call: `invoke<string>('session_load', ...)` or `invoke('session_save', ...)`. */
const INVOKE_CALL = /\binvoke(?:<[^>(]*>)?\(\s*'([^']+)'/g;

/** The distinct command names the frontend sources invoke, sorted. */
export function invokedCommands(sources: string[]): string[] {
  return sorted([...new Set(sources.flatMap((source) => [...source.matchAll(INVOKE_CALL)].map((m) => m[1])))]);
}
