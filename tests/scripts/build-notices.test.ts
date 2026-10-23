// Task 14: THIRD-PARTY-NOTICES, generated offline from the installed npm production packages and the crates
// compiled into the exe, ships in the install folder and on the About screen.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatThirdPartyNotices, licenceTextsIn, shippedCrates, type CrateGraph } from '../../scripts/build-notices';

const ROOT = path.resolve(__dirname, '../..');
const NOTICES = path.join(ROOT, 'resources/notices/THIRD-PARTY-NOTICES.txt');

describe('licenceTextsIn', () => {
  it('reads LICENSE, LICENCE, COPYING and NOTICE files by name order, with Windows line ends made plain', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-'));
    fs.writeFileSync(path.join(dir, 'LICENSE-MIT'), 'MIT text\r\n');
    fs.writeFileSync(path.join(dir, 'LICENSE-APACHE'), 'Apache text\n\n');
    fs.writeFileSync(path.join(dir, 'NOTICE'), 'Notice text');
    fs.writeFileSync(path.join(dir, 'README.md'), 'not a licence');
    fs.mkdirSync(path.join(dir, 'LICENSES'));
    expect(licenceTextsIn(dir)).toEqual(['Apache text', 'MIT text', 'Notice text']);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('formatThirdPartyNotices', () => {
  it('prints each licence text once, under every package that ships it, and lists packages without a file', () => {
    const text = formatThirdPartyNotices([
      { name: 'b', version: '2.0.0', licence: 'MIT', texts: ['Same text'] },
      { name: 'a', version: '1.0.0', licence: 'MIT', texts: ['Same text'] },
      { name: 'c', version: '3.0.0', licence: 'Apache-2.0', texts: ['Other text'] },
      { name: 'd', version: '4.0.0', licence: 'ISC', texts: [] },
    ]);
    expect(text.match(/Same text/g)).toHaveLength(1);
    expect(text).toContain('a 1.0.0 (MIT)\nb 2.0.0 (MIT)\n\nSame text');
    expect(text).toContain('c 3.0.0 (Apache-2.0)\n\nOther text');
    expect(text).toContain('d 4.0.0 (ISC)');
    expect(text.indexOf('a 1.0.0')).toBeLessThan(text.indexOf('c 3.0.0'));
  });
});

describe('shippedCrates', () => {
  it('follows normal dependencies from the app only: build and dev dependencies are not in the exe', () => {
    const graph: CrateGraph = {
      root: 'app',
      nodes: [
        { id: 'app', deps: [{ pkg: 'lib', dep_kinds: [{ kind: null }] }, { pkg: 'builder', dep_kinds: [{ kind: 'build' }] }, { pkg: 'tester', dep_kinds: [{ kind: 'dev' }] }] },
        { id: 'lib', deps: [{ pkg: 'inner', dep_kinds: [{ kind: null }] }] },
        { id: 'inner', deps: [] },
        { id: 'builder', deps: [{ pkg: 'inner-build', dep_kinds: [{ kind: null }] }] },
        { id: 'tester', deps: [] },
        { id: 'inner-build', deps: [] },
      ],
    };
    expect([...shippedCrates(graph)].sort()).toEqual(['inner', 'lib']);
  });
});

describe('the committed THIRD-PARTY-NOTICES.txt', () => {
  const notices = fs.readFileSync(NOTICES, 'utf8');
  const installed = (name: string) => (JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;
  const locked = (crate: string) => fs.readFileSync(path.join(ROOT, 'src-tauri/Cargo.lock'), 'utf8').match(new RegExp(`name = "${crate}"\\r?\\nversion = "([^"]+)"`))![1];

  it.each(['react', 'react-dom', '@codemirror/view', 'jszip', '@tauri-apps/api', 'react-intl', 'harper.js'])('lists the npm package %s at its installed version', (name) => {
    expect(notices).toContain(`${name} ${installed(name)} (`);
  });

  it.each(['tauri', 'tauri-runtime-wry', 'wry', 'serde', 'sha2'])('lists the crate %s at its locked version', (crate) => {
    expect(notices).toContain(`${crate} ${locked(crate)} (`);
  });

  it('leaves out dev-only npm tools and build-only crates', () => {
    expect(notices).not.toContain('vitest ');
    expect(notices).not.toContain('tauri-build ');
  });
});
