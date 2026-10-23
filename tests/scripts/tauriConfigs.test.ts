// Task 14 fix round 2: the version without AI is tauri.conf.json with tauri.noai.conf.json merged over it, as
// `tauri build --config` does (JSON Merge Patch, RFC 7396).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mergePatch, readTauriConfigs } from '../../scripts/tauriConfigs';

const ROOT = path.resolve(__dirname, '../..');

describe('mergePatch (RFC 7396)', () => {
  it('merges objects, replaces everything else, and deletes a key set to null', () => {
    expect(mergePatch({ a: { b: 1, c: 2 }, d: [1, 2], e: 'x' }, { a: { b: null, f: 3 }, d: [3], e: 'y' })).toEqual({ a: { c: 2, f: 3 }, d: [3], e: 'y' });
    expect(mergePatch({ a: 1 }, { a: { b: null, c: 1 } })).toEqual({ a: { c: 1 } });
  });

  it('leaves the target unchanged', () => {
    const target = { a: { b: 1 } };
    mergePatch(target, { a: { b: null } });
    expect(target).toEqual({ a: { b: 1 } });
  });
});

describe('the two release configs', () => {
  const { full, noai } = readTauriConfigs(path.join(ROOT, 'src-tauri'));
  const resources = (conf: Record<string, unknown>) => (conf.bundle as { resources: Record<string, string> }).resources;

  it('the version without AI bundles everything but the llama.cpp files and the runtime beside them', () => {
    const { 'binaries/llama/*': llama, 'binaries/vulkan/*': vulkan, ...rest } = resources(full);
    expect([llama, vulkan]).toEqual(['llama/', 'llama/vulkan/']);
    expect(resources(noai)).toEqual(rest);
  });

  it('both are the same app: same name, identifier, version, CSP and installer settings, so one installs over the other', () => {
    for (const key of ['productName', 'identifier', 'version', 'app']) expect(noai[key]).toEqual(full[key]);
    const windows = (conf: Record<string, unknown>) => (conf.bundle as { windows: Record<string, unknown> }).windows;
    expect(windows(noai).webviewInstallMode).toEqual({ type: 'skip' });
    expect((windows(noai).nsis as Record<string, unknown>).installMode).toBe('currentUser');
  });

  it('installed over the full version, the version without AI removes the helper files it does not ship', () => {
    const hooks = ((noai.bundle as { windows: { nsis: { installerHooks: string } } }).windows.nsis.installerHooks);
    const text = fs.readFileSync(path.join(ROOT, 'src-tauri', hooks), 'utf8');
    expect(text).toMatch(/!macro NSIS_HOOK_POSTINSTALL\s+RMDir \/r "\$INSTDIR\\llama"\s+!macroend/);
    expect((full.bundle as { windows: { nsis: Record<string, unknown> } }).windows.nsis.installerHooks).toBeUndefined();
  });
});
