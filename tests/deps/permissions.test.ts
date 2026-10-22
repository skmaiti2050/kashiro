import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { findWidenings, readPermissionSurface } from '../../scripts/deps/permissions';

const TAURI = path.resolve(__dirname, '../../src-tauri');
const CONF = fs.readFileSync(path.join(TAURI, 'tauri.conf.json'), 'utf8');
const CAPABILITY = fs.readFileSync(path.join(TAURI, 'capabilities/default.json'), 'utf8');

/** The committed config with `edit` applied to the parsed tauri.conf.json. */
function editedConf(edit: (conf: { app: { security: Record<string, unknown> } } & Record<string, unknown>) => void): string {
  const conf = JSON.parse(CONF);
  edit(conf);
  return JSON.stringify(conf);
}

const baseline = readPermissionSurface(CONF, { 'default.json': CAPABILITY });

describe('findWidenings (tauri.conf.json CSP and capabilities against the committed baseline)', () => {
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
      'app.security.dangerousDisableAssetCspModification changed: (none) -> true',
    ]);
  });
});
