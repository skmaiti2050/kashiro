import { describe, expect, it } from 'vitest';
import { diffHarperSnapshots, diffJson, harperDiffMarkdown } from '../../scripts/deps/snapshotDiff';
import type { HarperSnapshot, SnapshotDoc, SnapshotFlag } from '../../scripts/deps/harperSnapshot';

const flag = (kind: string, start: number, message: string, suggestions: string[] = []): SnapshotFlag => ({
  kind,
  para: 0,
  start,
  end: start + 3,
  excerpt: 'teh',
  message,
  suggestions,
});
const doc = (flags: SnapshotFlag[], variant: SnapshotDoc['variant'] = 'British'): SnapshotDoc => ({
  id: 'reference/a.md',
  source: 'trust/reference',
  licence: 'Apache-2.0',
  sha256: 'x',
  variant,
  flags,
});
const snapshot = (docs: SnapshotDoc[]): HarperSnapshot => ({ harper: '2.13.0', reference: docs, samples: [], probes: [] });

describe('diffHarperSnapshots', () => {
  const before = snapshot([doc([flag('Spelling', 0, 'Did you mean “the”?', ['the']), flag('Style', 10, 'An Oxford comma is necessary here.'), flag('Typo', 20, 'Old.')])]);
  const after = snapshot([
    doc(
      [flag('Spelling', 0, 'Did you mean “the”?', ['the', 'tea']), flag('Style', 10, 'Add an Oxford comma.'), flag('Grammar', 30, 'New.')],
      'Indian',
    ),
  ]);
  const diff = diffHarperSnapshots(before, after);

  it('sorts flags into added, removed and changed, and names message-text changes', () => {
    expect(diff.added.map((c) => c.after!.kind)).toEqual(['Grammar']);
    expect(diff.removed.map((c) => c.before!.kind)).toEqual(['Typo']);
    expect(diff.changed.map((c) => c.after!.kind)).toEqual(['Spelling', 'Style']);
    expect(diff.messageChanges).toEqual([{ before: 'An Oxford comma is necessary here.', after: 'Add an Oxford comma.', count: 1 }]);
    expect(diff.variantChanges).toEqual(['reference/a.md: British -> Indian']);
  });

  it('writes a Markdown section with counts by kind', () => {
    const markdown = harperDiffMarkdown(diff);
    expect(markdown).toContain('| Grammar | 1 | 0 | 0 |');
    expect(markdown).toContain('| Typo | 0 | 1 | 0 |');
    expect(markdown).toContain('`An Oxford comma is necessary here.` -> `Add an Oxford comma.` (1)');
  });

  it('reports no changes for identical snapshots', () => {
    expect(harperDiffMarkdown(diffHarperSnapshots(before, before))).toBe('No changes in Harper flags.\n');
  });
});

describe('diffJson', () => {
  it('lists changed, added and removed leaves by path', () => {
    expect(diffJson({ npm: { 'a@1': 'MIT', 'b@1': 'ISC' }, n: 1 }, { npm: { 'a@1': 'MIT', 'c@2': 'MPL-2.0' }, n: 2 })).toEqual([
      'npm.b@1: removed (was "ISC")',
      'npm.c@2: added "MPL-2.0"',
      'n: 1 -> 2',
    ]);
  });
});
