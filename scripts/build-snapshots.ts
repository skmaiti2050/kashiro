/**
 * Regenerates the behaviour snapshots in deps/snapshots (Task S8). Offline; see docs/UPGRADING.md.
 *
 * Usage: npm run snapshots -- [--samples <sample-pack folder>]
 * Without --samples, the committed sample-pack section is kept as it is.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshots, SNAPSHOT_DIR, writeSnapshots } from './deps/snapshots';
import { argumentAfter } from './deps/run';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { files, warnings } = await buildSnapshots(ROOT, argumentAfter(process.argv, '--samples'));
writeSnapshots(ROOT, files);
for (const warning of warnings) console.warn(`warning: ${warning}`);
console.log(`Wrote ${Object.keys(files).join(', ')} to ${SNAPSHOT_DIR}.`);
