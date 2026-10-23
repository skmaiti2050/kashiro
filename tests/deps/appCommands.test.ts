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
    expect(handlers).toEqual([
      'llm_installed',
      'llm_start',
      'llm_stop',
      'os_locale',
      'overwrite_with_backup',
      'session_delete',
      'session_list',
      'session_load',
      'session_prune',
      'session_save',
      'sha256_file',
    ]);
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

  it('every command the frontend invokes, anywhere in src/, is registered, and every registered one is used', () => {
    const sources = fs
      .readdirSync(path.join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => read(path.join('src', file)));
    expect(sources.length).toBeGreaterThan(100);
    expect(invokedCommands(sources)).toEqual(handlers);
  });
});

describe('invokedCommands', () => {
  it('reads command names in every quote style, with or without a type argument', () => {
    const source = [
      "invoke('session_load', { key })",
      'invoke<string>("overwrite_with_backup", bytes)',
      'await invoke<{ port: number }>(`llm_start`, { modelPath })',
      'core.invoke(\n  "llm_stop"\n)',
      'invoke<Array<string>>("session_list")',
    ].join('\n');
    expect(invokedCommands([source])).toEqual(['llm_start', 'llm_stop', 'overwrite_with_backup', 'session_list', 'session_load']);
  });

  it('fails on a command name that is not a literal, so no call escapes the check', () => {
    expect(() => invokedCommands(['invoke(command, args)'])).toThrow('A Tauri command name must be a string literal: invoke(command');
    expect(() => invokedCommands(['invoke(`llm_${verb}`)'])).toThrow('must be a string literal');
    expect(() => invokedCommands(["invoke<void>('session_' + kind)"])).toThrow('must be a string literal');
  });

  it('fails on invoke imported under another name, whose calls the check could not see', () => {
    expect(() => invokedCommands(["import { invoke as call } from '@tauri-apps/api/core';\ncall('llm_start');"])).toThrow(
      'Import invoke under its own name, so the command check can see each call: invoke as call',
    );
    expect(() => invokedCommands(["import { convertFileSrc, invoke as tauriInvoke } from '@tauri-apps/api/core';"])).toThrow('invoke as tauriInvoke');
    expect(invokedCommands(["import { invoke } from '@tauri-apps/api/core';\ninvoke('llm_stop');"])).toEqual(['llm_stop']);
  });

  it('fails on invoke kept under another name by assignment or destructuring', () => {
    expect(() => invokedCommands(["const call = invoke;\ncall('llm_start');"])).toThrow('= invoke');
    expect(() => invokedCommands(['let send = invoke'])).toThrow('= invoke');
    expect(() => invokedCommands(["const { invoke: call } = await import('@tauri-apps/api/core');"])).toThrow('invoke: call');
    // Comparing or calling it is not a rename.
    expect(invokedCommands(["if (fn === invoke) invoke('llm_stop');"])).toEqual(['llm_stop']);
  });

  it('fails on core.invoke or a parenthesised invoke kept under another name (M4)', () => {
    expect(() => invokedCommands(['const call = core.invoke;'])).toThrow('= core.invoke');
    expect(() => invokedCommands(['const call = (invoke);'])).toThrow('= (invoke)');
    expect(() => invokedCommands(['const call = (core.invoke);'])).toThrow('= (core.invoke)');
    expect(() => invokedCommands(["let { invoke: call, transformCallback } = core;"])).toThrow('invoke: call');
    expect(invokedCommands(["const reply = core.invoke('llm_stop');"])).toEqual(['llm_stop']);
  });

  it('does not take a type member named invoke for a rename', () => {
    const source = [
      'interface Api { invoke: (command: string) => Promise<void>; }',
      'type Shell = { invoke: Function; other: number };',
      'function use(api: { invoke: Caller }) {}',
      "invoke('llm_stop');",
    ].join('\n');
    expect(invokedCommands([source])).toEqual(['llm_stop']);
  });

  it('ignores comments: a call in one is not a call, and a name in one is not a missing literal', () => {
    const source = [
      "// invoke('session_delete') used to run here",
      '/** Calls invoke(command) for each command. */',
      "/* const call = invoke; */ invoke('llm_stop');",
      "const url = 'http://127.0.0.1'; invoke('llm_start'); // trailing",
      'const re = /\\/\\/ not a comment/; invoke(`session_list`);',
    ].join('\n');
    expect(invokedCommands([source])).toEqual(['llm_start', 'llm_stop', 'session_list']);
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
