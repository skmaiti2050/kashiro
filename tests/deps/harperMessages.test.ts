/**
 * Message-text dependencies (Task S8): the engine and the UI match some of Harper's messages by their
 * wording. These tests fail loudly when a Harper upgrade changes that wording, instead of the app quietly
 * falling back (an Oxford comma nagging British writers, a heading title-case card, an untranslated card).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { explanation } from '@/ui/state/plainMessages';
import { snapshotDocuments } from '../../scripts/deps/harperSnapshot';
import { PROBES } from '../../scripts/deps/harperProbes';
import type { HarperSnapshot, SnapshotFlag } from '../../scripts/deps/harperSnapshot';

const SNAPSHOT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../deps/snapshots/harper.json'), 'utf8')) as HarperSnapshot;
const ALL_FLAGS: SnapshotFlag[] = [...SNAPSHOT.reference, ...SNAPSHOT.samples, ...SNAPSHOT.probes].flatMap((doc) => doc.flags);
const probeFlags = (id: string) => SNAPSHOT.probes.find((doc) => doc.id === `probes/${id}`)!.flags;

describe('the probe texts give the flags in the committed snapshot (live Harper)', () => {
  let linter: RulesLinter;
  beforeAll(async () => {
    linter = await createLinter('American');
  });

  it.each(PROBES.map((p) => [p.id, p] as const))('%s', async (id, probe) => {
    const [live] = await snapshotDocuments(linter, [
      { id: `probes/${id}`, fileName: probe.fileName, bytes: new TextEncoder().encode(probe.text), source: '', licence: '', storeText: true },
    ]);
    expect(live.flags).toEqual(probeFlags(id));
  });
});

describe('wording the engine matches (src/engine/tiers.ts, src/engine/presets.ts)', () => {
  it('Oxford comma: a Style flag whose message starts "An Oxford comma is necessary"', () => {
    expect(probeFlags('oxford-comma')).toContainEqual(
      expect.objectContaining({ kind: 'Style', message: expect.stringMatching(/^An Oxford comma is necessary/) }),
    );
  });

  it('heading title case: a Capitalization flag with exactly "Try to use title case in headings."', () => {
    expect(probeFlags('heading-title-case')).toContainEqual(
      expect.objectContaining({ kind: 'Capitalization', message: 'Try to use title case in headings.' }),
    );
  });

  it('fragments: Harper still has no fragment lint, so the script preset hides nothing for them', () => {
    expect(probeFlags('fragments')).toEqual([]);
  });
});

/** The card keys of src/ui/state/plainMessages.ts, one per rewrite pattern. */
const REWRITE_KEYS = [
  'explain.oneWord',
  'explain.notCounted',
  'explain.noPlural',
  'explain.aOrAn',
  'explain.the',
  'explain.linkingWord',
  'explain.pronouns',
  'explain.howOften',
  'explain.oneOfThe',
  'explain.addTo',
  'explain.twoWords',
  'explain.toToo',
  'explain.verbMatchesWord',
  'explain.verbMatchesSubject',
  'explain.its',
  'explain.repeated',
  'explain.probablyMean',
];

describe('plainMessages: every rewrite pattern still matches a Harper message in the snapshot', () => {
  it.each(REWRITE_KEYS)('%s', (key) => {
    const matching = ALL_FLAGS.filter(
      (flag) => flag.message && explanation({ message: flag.message, original: flag.excerpt ?? '', kind: flag.kind, source: 'rules' }).key === key,
    );
    expect(matching.length, `no message in deps/snapshots/harper.json gives ${key}: did Harper change its wording?`).toBeGreaterThan(0);
  });
});
