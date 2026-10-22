/**
 * Regenerates the committed behaviour snapshots in deps/snapshots (Task S8): harper.json, data.json and
 * licences.json. Used by `npm run snapshots` and by `npm run upgrade:check`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createLinter } from '../../src/engine/linter';
import { buildDataSnapshot } from './dataSnapshot';
import { formatHarperSnapshot, snapshotDocuments, type HarperSnapshot, type SnapshotInput } from './harperSnapshot';
import { buildLicenceSnapshot, readCargoMetadata } from './licenceSnapshot';
import { readNpmLicences } from './licences';
import { PROBES } from './harperProbes';
import { SAMPLE_FILES } from './samplePack';

export const SNAPSHOT_DIR = 'deps/snapshots';
export const SNAPSHOT_FILES = ['harper.json', 'data.json', 'licences.json'] as const;
export type SnapshotFile = (typeof SNAPSHOT_FILES)[number];

const formatJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function referenceInputs(root: string): SnapshotInput[] {
  const folder = path.join(root, 'trust/reference');
  const { docs } = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')) as { docs: { file: string }[] };
  return docs.map(({ file }) => ({
    id: `reference/${file}`,
    fileName: file,
    bytes: new Uint8Array(fs.readFileSync(path.join(folder, file))),
    source: 'trust/reference (written for this project)',
    licence: 'Apache-2.0',
    storeText: true,
  }));
}

function sampleInputs(samplesDir: string): SnapshotInput[] {
  return SAMPLE_FILES.map((sample) => {
    const file = path.join(samplesDir, sample.file);
    if (!fs.existsSync(file)) throw new Error(`Sample-pack file missing: ${sample.file} (in ${samplesDir}).`);
    return { id: `samples/${sample.file}`, fileName: sample.file, bytes: new Uint8Array(fs.readFileSync(file)), ...sample };
  });
}

const probeInputs = (): SnapshotInput[] =>
  PROBES.map((probe) => ({
    id: `probes/${probe.id}`,
    fileName: probe.fileName,
    bytes: new TextEncoder().encode(probe.text),
    source: 'scripts/deps/harperProbes.ts',
    licence: 'Apache-2.0',
    storeText: true,
  }));

function harperVersion(root: string): string {
  return (JSON.parse(fs.readFileSync(path.join(root, 'node_modules/harper.js/package.json'), 'utf8')) as { version: string }).version;
}

/**
 * The snapshot files' new text, by file name. Without `samplesDir` the committed samples section is kept
 * as it is (and a warning says so): the sample pack is not part of the repository.
 */
export async function buildSnapshots(root: string, samplesDir: string | undefined): Promise<{ files: Record<SnapshotFile, string>; warnings: string[] }> {
  const warnings: string[] = [];
  const linter = await createLinter('American');
  let samples: HarperSnapshot['samples'];
  if (samplesDir) samples = await snapshotDocuments(linter, sampleInputs(samplesDir));
  else {
    samples = readCommittedHarper(root)?.samples ?? [];
    warnings.push('No sample pack given (--samples <folder>): the samples section was kept, not re-checked.');
  }
  const harper: HarperSnapshot = {
    harper: harperVersion(root),
    reference: await snapshotDocuments(linter, referenceInputs(root)),
    samples,
    probes: await snapshotDocuments(linter, probeInputs()),
  };
  const npm = readNpmLicences(root);
  if (npm.missing.length) throw new Error(`Not installed, so their licences can't be recorded (run npm ci): ${npm.missing.join(', ')}.`);
  const licences = buildLicenceSnapshot(npm.packages, readCargoMetadata(path.join(root, 'src-tauri')));
  return {
    files: {
      'harper.json': formatHarperSnapshot(harper),
      'data.json': formatJson(await buildDataSnapshot(root)),
      'licences.json': formatJson(licences),
    },
    warnings,
  };
}

/** The committed text of a snapshot file, or undefined before the first run. */
export function readSnapshotFile(root: string, file: SnapshotFile): string | undefined {
  const full = path.join(root, SNAPSHOT_DIR, file);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : undefined;
}

function readCommittedHarper(root: string): HarperSnapshot | undefined {
  const text = readSnapshotFile(root, 'harper.json');
  return text ? (JSON.parse(text) as HarperSnapshot) : undefined;
}

export function writeSnapshots(root: string, files: Record<SnapshotFile, string>): void {
  fs.mkdirSync(path.join(root, SNAPSHOT_DIR), { recursive: true });
  for (const file of SNAPSHOT_FILES) fs.writeFileSync(path.join(root, SNAPSHOT_DIR, file), files[file]);
}
