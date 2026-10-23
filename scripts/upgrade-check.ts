/**
 * `npm run upgrade:check` (Task S8): run after upgrading one dependency, before committing it. Writes
 * deps/reports/upgrade-report.md with:
 *   - the snapshot diffs (Harper flags, dictionary and word lists, licences), after regenerating the
 *     snapshots in deps/snapshots in place so that `git diff` shows them too;
 *   - type check, tests (unit and DOM, then timing alone), trust suite (alone), and the gates inside them;
 *   - cargo test and a Tauri debug build;
 *   - the CSP and capabilities compared with the committed baseline deps/snapshots/permissions.json (any
 *     widening fails; this script never rewrites the baseline, see scripts/accept-permissions.ts);
 *   - licences not on the allowlist;
 *   - the bundled files: src-tauri/binaries holds exactly the pinned llama.cpp files, and
 *     resources/notices/THIRD-PARTY-NOTICES.txt equals what `npm run build:notices` would write now.
 * Exits 1 when anything fails. Offline except what cargo itself fetches for the build.
 *
 *   - the lockfile graph changes against HEAD; with --expect, any change outside those packages fails.
 *
 * Usage: npm run upgrade:check -- --expect <package> [--expect <package>...] [--samples <sample-pack folder>]
 *        [--dakshina <google-dakshina.csv>]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshots, readSnapshotFile, writeSnapshots, SNAPSHOT_DIR, type SnapshotFile } from './deps/snapshots';
import { diffHarperSnapshots, diffJson, harperDiffMarkdown } from './deps/snapshotDiff';
import { checkPermissions, PERMISSION_BASELINE } from './deps/permissions';
import { decisionsVerdict } from './deps/referenceValues';
import { licenceFailures, type PackageLicence } from './deps/licences';
import type { LicenceSnapshot } from './deps/licenceSnapshot';
import { argumentAfter, argumentsAfter, lastLines, runTool } from './deps/run';
import { cargoLockGraph, changesOutside, diffLockGraphs, npmLockGraph, type LockGraph } from './deps/lockDiff';
import { execFileSync } from 'node:child_process';
import { pinnedBuildProblems } from './fetch-llama';
import { staleNotices } from './build-notices';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(ROOT, 'deps/reports');
const DECISIONS_MD = path.join(ROOT, 'trust/out/decisions.md');
const REFERENCE_VALUES = path.join(ROOT, SNAPSHOT_DIR, 'reference-values.json');
const DECISIONS_KEY = 'trust/out/decisions.md md5';
const UNIT_JSON = path.join(REPORTS, 'vitest-unit.json');

/** Test files that carry a gate, by gate name (S5 was dropped). */
const GATES: [string, string[]][] = [
  ['Review budget and recall', ['tests/decisions.test.ts']],
  ['S6 suggestion ranking', ['tests/engine/suggestionRanking.test.ts']],
  ['S7 words in other languages (engine)', ['tests/engine/otherLanguage.test.ts', 'tests/engine/romanisedModel.test.ts']],
  ['Harper message wording', ['tests/deps/harperMessages.test.ts']],
];

const failures: string[] = [];

async function snapshotSection(samplesDir: string | undefined): Promise<string[]> {
  const before = Object.fromEntries((['harper.json', 'data.json', 'licences.json'] as SnapshotFile[]).map((f) => [f, readSnapshotFile(ROOT, f)]));
  const { files, warnings } = await buildSnapshots(ROOT, samplesDir);
  writeSnapshots(ROOT, files);
  const lines = ['## Behaviour snapshots', '', ...warnings.map((w) => `Warning: ${w}`), ''];
  const parse = (text: string | undefined) => (text ? JSON.parse(text) : undefined);

  lines.push('### Harper flags (`deps/snapshots/harper.json`)', '');
  const oldHarper = parse(before['harper.json']);
  lines.push(oldHarper ? harperDiffMarkdown(diffHarperSnapshots(oldHarper, JSON.parse(files['harper.json']))) : 'No committed snapshot to compare with.', '');

  for (const file of ['data.json', 'licences.json'] as const) {
    const old = parse(before[file]);
    const changes = old ? diffJson(old, JSON.parse(files[file])) : ['No committed snapshot to compare with.'];
    lines.push(`### ${file === 'data.json' ? 'Dictionary and word lists' : 'Licences'} (\`deps/snapshots/${file}\`)`, '');
    lines.push(...(changes.length ? changes.map((c) => `- ${c}`) : ['No changes.']), '');
  }

  const licences = JSON.parse(files['licences.json']) as LicenceSnapshot;
  const asPackages = (map: Record<string, string>): PackageLicence[] =>
    Object.entries(map).map(([key, licence]) => {
      const at = key.lastIndexOf('@');
      return { name: key.slice(0, at), version: key.slice(at + 1), licence: licence === '(none)' ? undefined : licence };
    });
  const blocked = [...licenceFailures(asPackages(licences.npm), 'npm'), ...licenceFailures(asPackages(licences.crates), 'crate')];
  lines.push('### Licence allowlist', '');
  if (!blocked.length) lines.push('All npm production packages and crates are on the allowlist.', '');
  for (const b of blocked) {
    failures.push(`licence: ${b.name} ${b.version} (${b.reason})`);
    lines.push(`- **${b.name} ${b.version}**: ${b.reason}`);
  }
  return [...lines, ''];
}

/** Runs one step, records a failure, and returns its report lines. */
function step(title: string, command: string, cwd: string, tail = 12): string[] {
  console.log(`- ${title}: ${command}`);
  const result = runTool(command, cwd);
  if (result.status !== 'ok') failures.push(`${title} (${result.status})`);
  const output = lastLines(`${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, ''), tail);
  return [`### ${title}: ${result.status === 'ok' ? 'passed' : result.status.toUpperCase()} (${result.seconds} s)`, '', `\`${command}\``, '', '```', output, '```', ''];
}

interface VitestJson {
  testResults: { name: string; status: string; assertionResults: { status: string }[] }[];
}

function gateLines(): string[] {
  if (!fs.existsSync(UNIT_JSON)) return ['Gate results unavailable (no vitest JSON output).', ''];
  const results = (JSON.parse(fs.readFileSync(UNIT_JSON, 'utf8')) as VitestJson).testResults;
  const lines = ['| Gate | Tests passed | Result |', '|---|---|---|'];
  for (const [gate, files] of GATES) {
    const ofGate = results.filter((r) => files.some((f) => r.name.replace(/\\/g, '/').endsWith(f)));
    const tests = ofGate.flatMap((r) => r.assertionResults);
    const passed = tests.filter((t) => t.status === 'passed').length;
    const ok = ofGate.length === files.length && ofGate.every((r) => r.status === 'passed');
    if (!ok) failures.push(`gate: ${gate}`);
    lines.push(`| ${gate} | ${passed}/${tests.length} | ${ok ? 'pass' : 'FAIL'} |`);
  }
  return [...lines, '', 'S5 (context check) was dropped, so it has no gate.', ''];
}

function decisionsLines(): string[] {
  const md5 = fs.existsSync(DECISIONS_MD) ? createHash('md5').update(fs.readFileSync(DECISIONS_MD)).digest('hex') : undefined;
  const committed = fs.existsSync(REFERENCE_VALUES) ? (JSON.parse(fs.readFileSync(REFERENCE_VALUES, 'utf8')) as Record<string, string>) : {};
  const verdict = decisionsVerdict(md5, committed[DECISIONS_KEY]);
  if (verdict.failed) failures.push('decisions table missing');
  if (verdict.record) {
    fs.writeFileSync(REFERENCE_VALUES, `${JSON.stringify({ [DECISIONS_KEY]: md5 }, null, 2)}\n`);
    fs.copyFileSync(DECISIONS_MD, path.join(REPORTS, 'decisions.md'));
  }
  return [verdict.line, ''];
}

/**
 * What the build will bundle: the llama.cpp folders hold exactly the pinned files (no stale or unpinned
 * file), and the third-party notices match the installed packages byte for byte.
 */
function bundledFilesLines(): string[] {
  const problems = [...pinnedBuildProblems(), ...staleNotices(ROOT)];
  failures.push(...problems.map((p) => `bundled files: ${p}`));
  const body = problems.length ? problems.map((p) => `- **${p}**`) : ['llama.cpp files match deps/assets.json exactly; THIRD-PARTY-NOTICES.txt is current.'];
  return ['## Bundled files', '', ...body, ''];
}

/** Compared with the committed baseline file, which only `npm run deps:accept-permissions` rewrites. */
function permissionLines(): string[] {
  const widenings = checkPermissions(ROOT);
  failures.push(...widenings.map((w) => `permissions: ${w}`));
  const body = widenings.length ? widenings.map((w) => `- **${w}**`) : [`CSP and capabilities: no widening compared with ${PERMISSION_BASELINE}.`];
  return [`## Permissions (CSP and capabilities vs ${PERMISSION_BASELINE})`, '', ...body, ''];
}

/** The lockfiles and how to read each into a dependency graph. */
const LOCKFILES: [string, (text: string) => LockGraph][] = [
  ['src-tauri/Cargo.lock', cargoLockGraph],
  ['package-lock.json', npmLockGraph],
];

/**
 * What this change did to each lockfile, against the committed one at HEAD. With --expect, a change that
 * belongs to none of the expected packages fails (cargo update -p can move other crates too); an edge
 * re-pointed between versions already in the lock is only a warning.
 */
function lockfileLines(expected: string[]): string[] {
  const scope = expected.length ? `expected: ${expected.join(', ')}` : 'no --expect given, so nothing is limited';
  const lines = [`## Lockfile changes against HEAD (${scope})`, ''];
  for (const [file, readGraph] of LOCKFILES) {
    const committed = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const changes = diffLockGraphs(readGraph(committed), readGraph(fs.readFileSync(path.join(ROOT, file), 'utf8')));
    const outside = expected.length ? changesOutside(changes, expected) : [];
    failures.push(...outside.map((c) => `lockfile change outside --expect: ${c.text}`));
    lines.push(`### ${file}: ${changes.length ? `${changes.length} changes` : 'unchanged'}`, '');
    for (const change of changes) {
      const label = outside.includes(change) ? '**unexpected:** ' : change.warning ? 'warning: ' : '';
      lines.push(`- ${label}${change.text}`);
    }
    if (changes.length) lines.push('');
  }
  return lines;
}

async function main(): Promise<void> {
  fs.mkdirSync(REPORTS, { recursive: true });
  const samples = argumentAfter(process.argv, '--samples');
  const dakshina = argumentAfter(process.argv, '--dakshina');
  const lockfiles = lockfileLines(argumentsAfter(process.argv, '--expect'));
  console.log('Regenerating snapshots...');
  const snapshots = await snapshotSection(samples);

  const checks = [
    '## Type check, tests and trust suite',
    '',
    ...step('Type check', 'npx tsc --noEmit', ROOT),
    ...step('Unit and DOM tests', `npx vitest run --project unit --project dom --reporter=default --reporter=json --outputFile.json="${UNIT_JSON}"`, ROOT),
    // Before the trust suite, which empties trust/out.
    ...decisionsLines(),
    ...step('Timing tests (alone)', 'npx vitest run --project timing', ROOT),
    ...step('Trust suite (alone)', 'npm run trust', ROOT, 25),
    '### Gates',
    '',
    ...gateLines(),
    ...(dakshina
      ? step('S7 dataset gate', `npx tsx scripts/measure-other-language.ts "${dakshina}" test`, ROOT, 20)
      : ['S7 dataset gate: not run (pass --dakshina <google-dakshina.csv>).', '']),
    '## Rust',
    '',
    ...step('cargo test', 'cargo test', path.join(ROOT, 'src-tauri')),
    ...step('Tauri debug build', 'npx tauri build --debug --no-bundle', ROOT),
  ];

  const permissions = permissionLines();
  const bundled = bundledFilesLines();

  const report = [
    '# Upgrade check',
    '',
    `Generated ${new Date().toISOString().slice(0, 10)}. ${failures.length ? `**FAILED** (${failures.length})` : 'All checks passed.'}`,
    '',
    ...(failures.length ? ['Failures:', '', ...failures.map((f) => `- ${f}`), ''] : []),
    ...lockfiles,
    ...snapshots,
    ...checks,
    ...permissions,
    ...bundled,
  ];
  fs.writeFileSync(path.join(REPORTS, 'upgrade-report.md'), report.join('\n'));
  console.log(`${failures.length ? `FAILED: ${failures.join('; ')}` : 'All checks passed.'} Report: deps/reports/upgrade-report.md`);
  if (failures.length) process.exitCode = 1;
}

await main();
