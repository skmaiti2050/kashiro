import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cargoLockGraph, changesOutside, diffLockGraphs, npmLockGraph, type LockChange } from '../../scripts/deps/lockDiff';

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../fixtures/lockfiles', file), 'utf8');
const texts = (changes: LockChange[]) => changes.map((c) => `${c.warning ? 'warning: ' : ''}${c.text}`);

describe('Cargo.lock graph diff', () => {
  const changes = diffLockGraphs(cargoLockGraph(read('cargo-before.lock')), cargoLockGraph(read('cargo-after.lock')));

  it('shows a version bump, an added package, and an edge re-pointed between existing versions as a warning', () => {
    expect(texts(changes)).toEqual([
      'warning: cssparser-macros 0.7.1: syn 3.0.9 -> 2.0.119 (re-pointed between existing versions)',
      'mio: added 1.0.0',
      'tokio: 1.54.0 -> 1.54.1',
    ]);
  });

  it('--expect tokio: a new package outside it fails; a re-point between existing versions does not', () => {
    expect(texts(changesOutside(changes, ['tokio']))).toEqual(['mio: added 1.0.0']);
    expect(changesOutside(changes, ['tokio', 'mio'])).toEqual([]);
  });

  it('an edge to a version that was not in the base lock fails, as a new version of that package', () => {
    const newVersion = diffLockGraphs(cargoLockGraph(read('cargo-before.lock')), cargoLockGraph(read('cargo-after-new-version.lock')));
    expect(texts(changesOutside(newVersion, ['tokio']))).toEqual(['syn: 2.0.119, 3.0.9 -> 2.0.119, 3.0.9, 4.0.0']);
  });

  it('finds nothing when the lockfile did not change', () => {
    const before = cargoLockGraph(read('cargo-before.lock'));
    expect(diffLockGraphs(before, cargoLockGraph(read('cargo-before.lock')))).toEqual([]);
  });
});

describe('package-lock.json graph diff', () => {
  const changes = diffLockGraphs(npmLockGraph(read('npm-before.json')), npmLockGraph(read('npm-after.json')));

  it('shows a version bump, added and removed packages, and a nesting re-point between existing versions as a warning', () => {
    expect(texts(changes)).toEqual([
      'a: 1.0.0 -> 1.1.0',
      'warning: b 1.0.0: c 2.0.0 -> 1.0.0 (re-pointed between existing versions)',
      'd: added 1.0.0',
      'old-tool: removed 1.0.0',
    ]);
  });

  it('names each change by the package that changed, so --expect can match it', () => {
    expect(changes.map((c) => c.name)).toEqual(['a', 'b', 'd', 'old-tool']);
    expect(texts(changesOutside(changes, ['a', 'd']))).toEqual(['old-tool: removed 1.0.0']);
  });
});
