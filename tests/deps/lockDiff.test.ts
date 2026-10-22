import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cargoLockGraph, changesOutside, diffLockGraphs, npmLockGraph } from '../../scripts/deps/lockDiff';

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../fixtures/lockfiles', file), 'utf8');
const texts = (changes: { text: string }[]) => changes.map((c) => c.text);

describe('Cargo.lock graph diff', () => {
  const changes = diffLockGraphs(cargoLockGraph(read('cargo-before.lock')), cargoLockGraph(read('cargo-after.lock')));

  it('shows a version bump, an added package and a re-pointed edge in another crate', () => {
    expect(texts(changes)).toEqual(['cssparser-macros 0.7.1: syn 3.0.9 -> 2.0.119', 'mio: added 1.0.0', 'tokio: 1.54.0 -> 1.54.1']);
  });

  it('--expect tokio: everything outside tokio fails, with the list', () => {
    expect(texts(changesOutside(changes, ['tokio']))).toEqual(['cssparser-macros 0.7.1: syn 3.0.9 -> 2.0.119', 'mio: added 1.0.0']);
    expect(changesOutside(changes, ['tokio', 'mio', 'cssparser-macros'])).toEqual([]);
  });

  it('finds nothing when the lockfile did not change', () => {
    const before = cargoLockGraph(read('cargo-before.lock'));
    expect(diffLockGraphs(before, cargoLockGraph(read('cargo-before.lock')))).toEqual([]);
  });
});

describe('package-lock.json graph diff', () => {
  const changes = diffLockGraphs(npmLockGraph(read('npm-before.json')), npmLockGraph(read('npm-after.json')));

  it('shows a version bump, added and removed packages, and an edge re-pointed by node_modules nesting', () => {
    expect(texts(changes)).toEqual(['a: 1.0.0 -> 1.1.0', 'b 1.0.0: c 2.0.0 -> 1.0.0', 'd: added 1.0.0', 'old-tool: removed 1.0.0']);
  });

  it('names each change by the package that changed, so --expect can match it', () => {
    expect(changes.map((c) => c.name)).toEqual(['a', 'b', 'd', 'old-tool']);
    expect(texts(changesOutside(changes, ['a', 'd']))).toEqual(['b 1.0.0: c 2.0.0 -> 1.0.0', 'old-tool: removed 1.0.0']);
  });
});
