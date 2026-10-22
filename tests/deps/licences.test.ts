import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { allowedLicences, checkLicence, licenceFailures, readNpmLicences } from '../../scripts/deps/licences';

const FIXTURE = path.resolve(__dirname, '../fixtures/licences');

describe('checkLicence (the allowlist)', () => {
  it.each(['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'Zlib', 'Unicode-3.0', 'CC0-1.0', 'OFL-1.1'])('allows %s everywhere', (id) => {
    expect(checkLicence(id, 'npm')).toEqual({ ok: true });
    expect(checkLicence(id, 'crate')).toEqual({ ok: true });
    expect(checkLicence(id, 'data')).toEqual({ ok: true });
  });

  it('allows CC BY-SA for data only', () => {
    expect(checkLicence('CC-BY-SA-4.0', 'data').ok).toBe(true);
    expect(checkLicence('CC-BY-SA-4.0', 'npm').ok).toBe(false);
  });

  it('allows MPL-2.0 for crates only', () => {
    expect(checkLicence('MPL-2.0', 'crate').ok).toBe(true);
    expect(checkLicence('MPL-2.0', 'npm').ok).toBe(false);
  });

  it('rejects a non-commercial licence with a reason that says so', () => {
    expect(checkLicence('CC-BY-NC-4.0', 'data')).toEqual({ ok: false, reason: 'non-commercial licence: CC-BY-NC-4.0' });
    expect(checkLicence('CC-BY-NC-SA-4.0', 'npm').ok).toBe(false);
  });

  it('rejects an unknown or missing licence', () => {
    expect(checkLicence('GPL-3.0', 'npm')).toEqual({ ok: false, reason: 'not on the allowlist: GPL-3.0' });
    expect(checkLicence('SEE LICENSE IN LICENSE.txt', 'npm')).toEqual({ ok: false, reason: 'not a valid licence expression: SEE LICENSE IN LICENSE.txt' });
    expect(checkLicence(undefined, 'npm')).toEqual({ ok: false, reason: 'no licence declared' });
  });

  it.each(['MIT OR AND', 'MIT OR', 'OR MIT', 'MIT AND', '(MIT', 'MIT)', 'MIT WITH', '()', 'MIT Apache-2.0'])(
    'rejects the malformed expression %s, even when one part is allowed',
    (expression) => {
      expect(checkLicence(expression, 'npm')).toEqual({ ok: false, reason: `not a valid licence expression: ${expression}` });
    },
  );

  it('reads SPDX expressions: one allowed choice of an OR is enough, every part of an AND must be allowed', () => {
    expect(checkLicence('MIT OR Apache-2.0', 'crate').ok).toBe(true);
    expect(checkLicence('(MIT OR GPL-3.0)', 'npm').ok).toBe(true);
    expect(checkLicence('MIT AND GPL-3.0', 'npm')).toEqual({ ok: false, reason: 'not on the allowlist: GPL-3.0' });
    expect(checkLicence('(MIT OR Apache-2.0) AND Unicode-3.0', 'crate').ok).toBe(true);
    expect(checkLicence('Apache-2.0 WITH LLVM-exception OR MIT', 'crate').ok).toBe(true);
    expect(checkLicence('MIT/Apache-2.0', 'crate').ok).toBe(true); // old crates.io slash form
  });
});

describe('src-tauri/deny.toml (cargo deny check licenses)', () => {
  it('allows exactly what the allowlist allows for crates', () => {
    const toml = fs.readFileSync(path.resolve(__dirname, '../../src-tauri/deny.toml'), 'utf8');
    const allowBlock = /^allow = \[([\s\S]*?)\]/m.exec(toml)![1];
    const denyAllows = [...allowBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect([...denyAllows].sort()).toEqual([...allowedLicences('crate')].sort());
  });
});

describe('readNpmLicences on a fixture project', () => {
  const { packages, missing } = readNpmLicences(FIXTURE);

  it('lists the production packages (scoped, nested and devOptional ones included) and leaves dev-only packages out', () => {
    expect(packages).toEqual([
      { name: '@fake-scope/object-licence', version: '3.0.0', licence: 'BSD-3-Clause' }, // "license": { "type": ... }
      { name: 'fake-dev-optional', version: '1.0.0', licence: 'Apache-2.0' }, // optional in production too
      { name: 'fake-mit', version: '1.0.0', licence: 'MIT' },
      { name: 'fake-nc', version: '1.0.0', licence: 'CC-BY-NC-4.0' },
      { name: 'fake-nested', version: '2.0.0', licence: 'ISC' }, // "licenses": [{ "type": ... }]
    ]);
  });

  it('rejects the fake non-commercial package', () => {
    expect(licenceFailures(packages, 'npm')).toEqual([
      { name: 'fake-nc', version: '1.0.0', licence: 'CC-BY-NC-4.0', reason: 'non-commercial licence: CC-BY-NC-4.0' },
    ]);
  });

  it('reports a production package that is not installed; an optional one (another platform) is skipped', () => {
    expect(missing).toEqual(['fake-not-installed@1.0.0']);
  });

  it('with no node_modules at all, every package is reported missing instead of "0 checked"', () => {
    expect(readNpmLicences(path.resolve(__dirname, '../fixtures/licences-not-installed'))).toEqual({
      packages: [],
      missing: ['fake-mit@1.0.0'],
    });
  });
});
