/**
 * `npm run deps:accept-permissions` (Task S8): records the current CSP and capabilities as the baseline
 * that upgrade:check compares with (deps/snapshots/permissions.json). Run it only for a deliberate,
 * reviewed change of what the app may do; the baseline's diff goes in that change's commit. upgrade:check
 * never rewrites the baseline itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWidenings, formatPermissionBaseline, PERMISSION_BASELINE, readPermissionBaseline, readWorkingSurface } from './deps/permissions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const current = readWorkingSurface(ROOT);
const previous = readPermissionBaseline(ROOT);
const widenings = previous ? findWidenings(previous, current) : ['(no baseline before)'];
fs.writeFileSync(path.join(ROOT, PERMISSION_BASELINE), formatPermissionBaseline(current));
console.log(`Wrote ${PERMISSION_BASELINE}. Widenings accepted: ${widenings.length ? widenings.join('; ') : 'none'}.`);
