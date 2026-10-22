/**
 * The app's own Tauri commands (Task S8b): every command in `generate_handler!` must be in the app manifest
 * (src-tauri/build.rs) and granted in a capability, and the other way round. Without a manifest entry, any
 * local webview could call a new command and the permissions guard would not see it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { allowPermission, handlerCommands, invokedCommands, manifestCommands } from '../../scripts/deps/appCommands';

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const handlers = handlerCommands(read('src-tauri/src/lib.rs'));
const manifest = manifestCommands(read('src-tauri/build.rs'));

describe('app commands (src-tauri)', () => {
  it('lists the registered commands', () => {
    expect(handlers).toEqual(['overwrite_with_backup', 'session_delete', 'session_list', 'session_load', 'session_prune', 'session_save']);
  });

  it('the app manifest in build.rs lists exactly the commands in generate_handler!', () => {
    expect(manifest).toEqual(handlers);
  });

  it('the default capability grants exactly those commands, with Tauri allow-<command> permissions', () => {
    // An entry is a permission name or a scoped permission object ({ identifier, allow }).
    type Entry = string | { identifier: string };
    const entries = (JSON.parse(read('src-tauri/capabilities/default.json')) as { permissions: Entry[] }).permissions;
    const identifiers = entries.map((p) => (typeof p === 'string' ? p : p.identifier));
    const granted = identifiers.filter((id) => id.startsWith('allow-')).sort();
    expect(granted).toEqual(handlers.map(allowPermission).sort());
    // App commands take no scope: a scoped object form of one would be a grant this check could misread.
    const scopedAppCommands = entries.filter((p) => typeof p !== 'string' && p.identifier.startsWith('allow-'));
    expect(scopedAppCommands).toEqual([]);
  });

  it('every command the frontend invokes is registered', () => {
    const sources = ['src/ui/platform/files.ts', 'src/ui/platform/sessions.ts'].map(read);
    expect(invokedCommands(sources)).toEqual(handlers);
  });
});

describe('the parsers', () => {
  it('reads handlers with module paths, and a manifest command list', () => {
    expect(handlerCommands('.invoke_handler(tauri::generate_handler![\n  a_cmd,\n  sessions::b_cmd\n])')).toEqual(['a_cmd', 'b_cmd']);
    expect(manifestCommands('AppManifest::new().commands(&["b_cmd", "a_cmd"])')).toEqual(['a_cmd', 'b_cmd']);
    expect(allowPermission('session_save')).toBe('allow-session-save');
  });

  it('throws when the list is missing, so the check cannot pass on nothing', () => {
    expect(() => handlerCommands('fn main() {}')).toThrow('No generate_handler! list found in src-tauri/src/lib.rs.');
    expect(() => manifestCommands('fn main() { tauri_build::build() }')).toThrow('No AppManifest commands list found in src-tauri/build.rs.');
  });
});
