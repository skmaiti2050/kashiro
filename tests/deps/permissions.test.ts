import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkPermissions,
  findWidenings,
  formatPermissionBaseline,
  readPermissionBaseline,
  readPermissionSurface,
  readWorkingSurface,
} from '../../scripts/deps/permissions';
import { parseCapabilityToml } from '../../scripts/deps/capabilityToml';

const ROOT = path.resolve(__dirname, '../..');
const TAURI = path.join(ROOT, 'src-tauri');
const CONF = fs.readFileSync(path.join(TAURI, 'tauri.conf.json'), 'utf8');
const CAPABILITY = fs.readFileSync(path.join(TAURI, 'capabilities/default.json'), 'utf8');

/** The committed config with `edit` applied to the parsed tauri.conf.json. */
function editedConf(edit: (conf: { app: { security: Record<string, unknown> } } & Record<string, unknown>) => void): string {
  const conf = JSON.parse(CONF);
  edit(conf);
  return JSON.stringify(conf);
}

const baseline = readPermissionSurface(CONF, { 'default.json': CAPABILITY });

describe('findWidenings (tauri.conf.json CSP and capabilities against a baseline)', () => {
  it('finds nothing when nothing changed', () => {
    expect(findWidenings(baseline, readPermissionSurface(CONF, { 'default.json': CAPABILITY }))).toEqual([]);
  });

  it('rejects an added remote host in the CSP', () => {
    const conf = editedConf((c) => {
      c.app.security.csp = String(c.app.security.csp).replace('connect-src', 'connect-src https://example.com');
    });
    expect(findWidenings(baseline, readPermissionSurface(conf, { 'default.json': CAPABILITY }))).toEqual([
      'csp connect-src adds https://example.com',
    ]);
  });

  it('rejects a removed directive (it falls back to default-src) and a removed CSP', () => {
    const noImg = editedConf((c) => {
      c.app.security.csp = String(c.app.security.csp).replace("img-src 'self' data:; ", '');
    });
    expect(findWidenings(baseline, readPermissionSurface(noImg, { 'default.json': CAPABILITY }))).toEqual(['csp drops img-src']);
    const noCsp = editedConf((c) => {
      c.app.security.csp = null;
    });
    expect(findWidenings(baseline, readPermissionSurface(noCsp, { 'default.json': CAPABILITY }))).toEqual(['csp removed']);
  });

  it('allows a narrowing', () => {
    const narrower = editedConf((c) => {
      c.app.security.csp = String(c.app.security.csp).replace(' data:', '');
    });
    expect(findWidenings(baseline, readPermissionSurface(narrower, { 'default.json': CAPABILITY }))).toEqual([]);
  });

  it('rejects an added permission, an added capability file and a changed security setting', () => {
    const capability = JSON.parse(CAPABILITY);
    capability.permissions.push('shell:allow-execute');
    const conf = editedConf((c) => {
      c.app.security.dangerousDisableAssetCspModification = true;
    });
    const current = readPermissionSurface(conf, {
      'default.json': JSON.stringify(capability),
      'extra.json': JSON.stringify({ identifier: 'extra', windows: ['main'], permissions: ['fs:default'] }),
    });
    expect(findWidenings(baseline, current)).toEqual([
      'capability default adds shell:allow-execute',
      'capability extra adds window main',
      'capability extra adds fs:default',
      'capability extra adds platforms all',
      'capability extra adds local true',
      'app.security.dangerousDisableAssetCspModification changed: ["style-src"] -> true',
    ]);
  });

  it('rejects a changed bundle.resources: the llama-server builds are bundled there, so another program could be', () => {
    const conf = editedConf((c) => {
      (c.bundle as { resources: Record<string, string> }).resources['binaries/other/*'] = 'llama/other/';
    });
    const [widening] = findWidenings(baseline, readPermissionSurface(conf, { 'default.json': CAPABILITY }));
    expect(widening).toMatch(/^bundle\.resources changed: .* -> .*binaries\/other/);
  });

  it('compares platforms: dropping the list (all platforms) or adding a platform widens', () => {
    const limited = (platforms?: string[]) =>
      readPermissionSurface(CONF, { 'default.json': JSON.stringify({ ...JSON.parse(CAPABILITY), platforms }) });
    const windowsOnly = limited(['windows']);
    expect(findWidenings(windowsOnly, limited(['windows', 'linux']))).toEqual(['capability default adds platform linux']);
    expect(findWidenings(windowsOnly, limited(undefined))).toEqual(['capability default adds platforms all']);
    expect(findWidenings(limited(['windows', 'linux']), windowsOnly)).toEqual([]);
    expect(findWidenings(limited(undefined), windowsOnly)).toEqual([]);
  });

  it('reads TOML capability files like JSON ones', () => {
    const toml = [
      '# The main window',
      'identifier = "default"',
      'windows = ["main"]',
      'permissions = [',
      '  "core:default",',
      '  "shell:allow-execute",',
      ']',
      '',
      '[remote]',
      'urls = ["https://example.com"]',
    ].join('\n');
    expect(findWidenings(baseline, readPermissionSurface(CONF, { 'default.toml': toml }))).toEqual([
      'capability default adds remote https://example.com',
      'capability default adds shell:allow-execute',
    ]);
  });
});

describe('capability files as Tauri 2 reads them (tauri-utils acl::build::parse_capabilities)', () => {
  const FIXTURES = path.join(ROOT, 'tests/fixtures');

  it('reads src-tauri/capabilities recursively (./capabilities/**/*), lists in a file included, the schemas folder skipped', () => {
    expect(readWorkingSurface(path.join(FIXTURES, 'permissions')).capabilities).toEqual({
      listed: ['window main', 'fs:default', 'platforms all', 'local true'],
      nested: ['window main', 'shell:allow-execute', 'platforms all', 'local true'],
      main: ['window main', 'core:default', 'platforms all', 'local true'],
    });
  });

  it('fails on a capability identifier defined twice, as Tauri does', () => {
    const one = JSON.stringify({ identifier: 'main', windows: ['main'] });
    expect(() => readPermissionSurface(CONF, { 'a.json': one, 'sub/b.json': `[${one}]` })).toThrow(
      'Capability "main" is defined twice (a.json, sub/b.json); Tauri refuses to build that.',
    );
    expect(checkPermissions(path.join(FIXTURES, 'permissions-duplicate'))).toEqual([
      'cannot read the permissions: Capability "main" is defined twice (a.json, sub/b.json); Tauri refuses to build that.',
    ]);
  });

  it('refuses a .json5 capability it cannot read', () => {
    expect(() => readPermissionSurface(CONF, { 'x.json5': '{}' })).toThrow('Cannot read capability file x.json5: write it as .json or .toml.');
  });
});

describe('parseCapabilityToml', () => {
  it('throws on a duplicate key and on a second [remote] table', () => {
    expect(() => parseCapabilityToml('windows = ["main"]\nwindows = ["other"]')).toThrow('Duplicate key "windows" in capability TOML.');
    expect(() => parseCapabilityToml('[remote]\nurls = ["https://a.example"]\n[remote]\nurls = ["https://b.example"]')).toThrow(
      'A second [remote] table in capability TOML.',
    );
    expect(() => parseCapabilityToml('[remote]\nurls = ["https://a.example"]\nurls = ["https://b.example"]')).toThrow(
      'Duplicate key "urls" in capability TOML.',
    );
  });

  it('refuses what it cannot read instead of reading less than is there', () => {
    expect(() => parseCapabilityToml('permissions = [{ identifier = "fs:scope", allow = ["*"] }]')).toThrow(
      'Cannot read capability TOML line "permissions = [{ identifier = "fs:scope", allow = ["*"] }]": only strings, booleans and arrays of strings are supported; write this capability as JSON.',
    );
    expect(() => parseCapabilityToml('[[permissions]]\nidentifier = "fs:scope"')).toThrow('Cannot read capability TOML line "[[permissions]]"');
  });
});

describe('the release config without AI (tauri.noai.conf.json, Task 14 fix round 2)', () => {
  const FIXTURE = path.join(ROOT, 'tests/fixtures/permissions-noai');
  const hooksSha = createHash('sha256').update(fs.readFileSync(path.join(FIXTURE, 'src-tauri/hooks.nsh'))).digest('hex');

  it('records what it changes, merged as Tauri merges it, and the installer hooks file by its sha256', () => {
    const { settings } = readWorkingSurface(FIXTURE);
    expect(settings['bundle.resources']).toBe('{"binaries/llama/*":"llama/","../LICENSE":"LICENSE.txt"}');
    expect(settings['noai bundle.resources']).toBe('{"../LICENSE":"LICENSE.txt"}');
    expect(settings['noai bundle.windows.nsis.installerHooks']).toBe(`hooks.nsh sha256 ${hooksSha}`);
    expect(settings).not.toHaveProperty('noai csp');
  });

  it('a CSP or hooks change in it widens the surface like one in tauri.conf.json', () => {
    const before = readWorkingSurface(FIXTURE);
    const after = { ...before, settings: { ...before.settings, 'noai csp': '{"csp":{"default-src":["*"]},"devCsp":null}' } };
    expect(findWidenings(before, after)).toEqual(['noai csp changed: (none) -> {"csp":{"default-src":["*"]},"devCsp":null}']);
  });
});

describe('the committed baseline (deps/snapshots/permissions.json)', () => {
  const committed = readPermissionBaseline(ROOT)!;

  it('is the output of readPermissionSurface, formatted the way deps:accept-permissions writes it', () => {
    const text = fs.readFileSync(path.join(ROOT, 'deps/snapshots/permissions.json'), 'utf8');
    expect(formatPermissionBaseline(committed)).toBe(text);
  });

  it('the working tree does not widen it', () => {
    expect(findWidenings(committed, readWorkingSurface(ROOT))).toEqual([]);
  });

  it('a widened working surface fails against it, even once the widening is committed to tauri.conf.json', () => {
    const widened = editedConf((c) => {
      c.app.security.csp = String(c.app.security.csp).replace('connect-src', 'connect-src https://example.com');
    });
    // Only tauri.conf.json is edited here, so the baseline's entries for the config without AI, and the installer
    // hooks (hashed from their files, which this test does not read), are left out.
    const confPart = {
      ...committed,
      settings: Object.fromEntries(Object.entries(committed.settings).filter(([key]) => !key.startsWith('noai ') && !key.endsWith('installerHooks'))),
    };
    expect(findWidenings(confPart, readPermissionSurface(widened, { 'default.json': CAPABILITY }))).toEqual([
      'csp connect-src adds https://example.com',
    ]);
  });

  it('checkPermissions fails when there is no baseline file', () => {
    expect(checkPermissions(__dirname)).toEqual(['no permissions baseline (deps/snapshots/permissions.json): run npm run deps:accept-permissions']);
  });
});
