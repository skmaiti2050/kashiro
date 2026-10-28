// Task 14 fix round 2: the version without AI is tauri.conf.json with tauri.noai.conf.json merged over it, as
// `tauri build --config` does (JSON Merge Patch, RFC 7396).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mergePatch, readTauriConfigs } from '../../scripts/tauriConfigs';
import { folderPinned } from '../../scripts/fetch-llama';

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

  it('the app is called Kashiro: product, exe, window title and a new identifier (Task R1)', () => {
    expect(full.productName).toBe('Kashiro');
    expect(full.mainBinaryName).toBe('Kashiro');
    expect(full.identifier).toBe('app.kashiro.desktop');
    expect((full.app as { windows: { title: string }[] }).windows[0].title).toBe('Kashiro');
  });

  // Task F17: CodeMirror's runtime <style> tag (style-mod) has no nonce, and a production nonce in style-src turns off
  // 'unsafe-inline', so the editor lost its layout and the document could not scroll. Script nonces stay.
  it('keeps the declared style-src as written: Tauri adds no style nonce, only script ones (Task F17)', () => {
    const security = (full.app as { security: { csp: string; dangerousDisableAssetCspModification?: unknown } }).security;
    expect(security.dangerousDisableAssetCspModification).toEqual(['style-src']);
    expect(security.csp).toMatch(/style-src 'self' 'unsafe-inline'(;|$)/);
    expect(security.csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('both are the same app: same name, identifier, version, CSP and installer settings, so one installs over the other', () => {
    for (const key of ['productName', 'mainBinaryName', 'identifier', 'version', 'app']) expect(noai[key]).toEqual(full[key]);
    const windows = (conf: Record<string, unknown>) => (conf.bundle as { windows: Record<string, unknown> }).windows;
    expect(windows(noai).webviewInstallMode).toEqual({ type: 'skip' });
    expect((windows(noai).nsis as Record<string, unknown>).installMode).toBe('currentUser');
  });

  describe('installed over the full version, the version without AI removes the helper files it does not ship (fix round 3)', () => {
    const hooks = (noai.bundle as { windows: { nsis: { installerHooks: string } } }).windows.nsis.installerHooks;
    const text = fs.readFileSync(path.join(ROOT, 'src-tauri', hooks), 'utf8');
    /** A Delete line of the hook: `Delete "$INSTDIR\llama\ggml.dll"`. */
    const DELETE_LINE = /^\s*Delete "\$INSTDIR\\(llama\\[^"]+)"\s*$/gm;

    it('the full config has only the close-the-app hooks; the version without AI includes them too', () => {
      expect((full.bundle as { windows: { nsis: Record<string, unknown> } }).windows.nsis.installerHooks).toBe('nsis/close-app.nsh');
      expect(text).toMatch(/^!include "\$\{__FILEDIR__\}\\close-app\.nsh"$/m);
    });

    it('deletes exactly the pinned files, by name: never a whole folder a user may own', () => {
      const deleted = [...text.matchAll(DELETE_LINE)].map((m) => m[1]).sort();
      const pinned = [...Object.keys(folderPinned('llama')).map((n) => `llama\\${n}`), ...Object.keys(folderPinned('vulkan')).map((n) => `llama\\vulkan\\${n}`)].sort();
      expect(deleted).toEqual(pinned);
      expect(text).not.toMatch(/RMDir \/r/i);
      expect(text).toMatch(/RMDir "\$INSTDIR\\llama\\vulkan"\s+RMDir "\$INSTDIR\\llama"/);
    });

    it('does it only in a folder that holds the app’s exe', () => {
      expect(text).toMatch(/\$\{If\} \$\{FileExists\} "\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"/);
    });
  });

  describe('reinstalling while the app is open asks the user to close it (Task U3 item 9)', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src-tauri', 'nsis', 'close-app.nsh'), 'utf8');

    it('before installing and before uninstalling', () => {
      expect(text).toMatch(/^!macro NSIS_HOOK_PREINSTALL$/m);
      expect(text).toMatch(/^!macro NSIS_HOOK_PREUNINSTALL$/m);
    });

    it('with Retry and Cancel, never by closing the app itself', () => {
      expect(text).toMatch(/MessageBox MB_RETRYCANCEL/);
      expect(text).toMatch(/Close \$\{PRODUCTNAME\} yourself/);
      expect(text).not.toMatch(/RmShutdown|taskkill|KillProcess/i);
    });

    it('asks only in an interactive install: a silent one keeps Tauri’s own handling', () => {
      expect(text).toMatch(/IfSilent/);
    });
  });
});
