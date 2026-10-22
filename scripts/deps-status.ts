/**
 * `npm run deps:status` (Task S8): what could be upgraded, known advisories and the licence check, as
 * deps/reports/deps-status.md. Developer-only: it uses the network (npm, cargo, release pages); the app
 * never does. It exits 1 when a licence is not on the allowlist (scripts/deps/licences.ts) or a production
 * package is not installed to read it from. A tool that is not installed is skipped with a warning (see
 * docs/UPGRADING.md for the pinned versions); a skipped licence check makes the headline "not fully checked".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS } from './deps/assets';
import { licenceFailures, readNpmLicences, type LicenceFailure } from './deps/licences';
import { lastLines, runTool, type ToolResult } from './deps/run';
import { checkUpstream } from './deps/upstream';
import { licenceVerdict, readCargoAudit, readCargoUpdate, readNpmAudit, readNpmOutdated } from './deps/toolReports';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAURI = path.join(ROOT, 'src-tauri');
const REPORT = path.join(ROOT, 'deps/reports/deps-status.md');

const warnings: string[] = [];
let licenceFailed = false;
/** Licence checks that were skipped: the headline must not say "all on the allowlist" then. */
const licencesNotChecked: string[] = [];

/** A missing tool becomes a warning; a failed run still shows its output. */
function toolNote(name: string, result: ToolResult): string | undefined {
  if (result.status !== 'missing') return undefined;
  const warning = `${name} is not installed: skipped (see docs/UPGRADING.md).`;
  warnings.push(warning);
  return `**Skipped:** ${warning}`;
}

/** A tool that gave no usable answer: a warning and a "could not check" line, never a clean result. */
function couldNotCheck(name: string, reason: string): string {
  const warning = `${name} could not check (${reason}).`;
  warnings.push(warning);
  return `**Could not check:** ${reason}.`;
}

function npmOutdated(): string[] {
  const report = readNpmOutdated(runTool('npm outdated --json', ROOT));
  if (!report.ok) return ['## npm packages (`npm outdated`)', '', couldNotCheck('npm outdated', report.reason), ''];
  const outdated = report.value;
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
  const rows = Object.entries(outdated).map(
    ([name, o]) => `| ${name} | ${o.current ?? '(not installed)'} | ${o.wanted} | ${o.latest} | ${name in (pkg.devDependencies ?? {}) ? 'dev' : 'production'} |`,
  );
  if (!rows.length) return ['## npm packages', '', 'All npm packages are at their latest version.', ''];
  return ['## npm packages (`npm outdated`)', '', '| Package | Current | Wanted | Latest | Use |', '|---|---|---|---|---|', ...rows, ''];
}

function cargoOutdated(): string[] {
  const lines = ['## Rust crates (`cargo update --dry-run --verbose`)', ''];
  const report = readCargoUpdate(runTool('cargo update --dry-run --verbose', TAURI));
  if (!report.ok) return [...lines, couldNotCheck('cargo update --dry-run', report.reason), ''];
  const { changes, heldBack } = report.value;
  lines.push(`Changes \`cargo update\` would make to Cargo.lock: ${changes.length}. Crates held back: ${heldBack.length}.`, '');
  if (changes.length) lines.push('Changes:', '', ...changes.map((l) => `- ${l}`), '');
  if (heldBack.length) lines.push('Held back (a newer version exists, but a version requirement keeps this one):', '', ...heldBack.map((l) => `- ${l}`), '');
  return lines;
}

async function assetUpdates(): Promise<string[]> {
  const lines = ['## Data files and models (`deps/assets.json`, best effort)', '', '| Asset | Status | Pinned | Latest upstream |', '|---|---|---|---|'];
  for (const asset of ASSETS) {
    if (asset.upstream.kind === 'in-repo' || asset.upstream.kind === 'none') {
      lines.push(`| ${asset.id} | ${asset.status} | ${asset.version ?? '-'} | - (${asset.upstream.kind}) |`);
      continue;
    }
    const result = await checkUpstream(asset);
    const latest = 'error' in result ? `could not check: ${result.error}` : `${result.latest}${result.update ? ' **(newer)**' : ''}`;
    lines.push(`| ${asset.id} | ${asset.status} | ${asset.upstream.current ?? asset.version ?? '-'} | ${latest} |`);
  }
  return [...lines, ''];
}

function npmAdvisories(): string[] {
  const lines = ['### npm (`npm audit --omit=dev`)', ''];
  const report = readNpmAudit(runTool('npm audit --omit=dev --json', ROOT));
  if (!report.ok) return [...lines, couldNotCheck('npm audit', report.reason), ''];
  const found = Object.entries(report.value.vulnerabilities);
  if (!found.length) lines.push('No known vulnerabilities in production npm packages.');
  for (const [name, v] of found) {
    const titles = v.via.map((via) => (typeof via === 'string' ? `via ${via}` : `${via.title} (${via.url})`)).join('; ');
    lines.push(`- **${name}** (${v.severity}): ${titles}`);
  }
  return [...lines, ''];
}

function advisories(): string[] {
  const lines = ['## Security advisories', '', ...npmAdvisories(), '### Rust (`cargo audit`)', ''];
  const result = runTool('cargo audit --json', TAURI);
  const note = toolNote('cargo-audit', result);
  if (note) return [...lines, note, ''];
  const report = readCargoAudit(result);
  if (!report.ok) return [...lines, couldNotCheck('cargo audit', report.reason), ''];
  const audit = report.value;
  const list = audit.vulnerabilities.list;
  lines.push(list.length ? `${list.length} vulnerabilities:` : 'No known vulnerabilities in Cargo.lock.', '');
  for (const v of list) lines.push(`- **${v.package.name} ${v.package.version}**: ${v.advisory.id} ${v.advisory.title}`);
  for (const [kind, items] of Object.entries(audit.warnings ?? {})) {
    for (const w of items) lines.push(`- warning (${kind}): ${w.package.name} ${w.package.version}${w.advisory ? `: ${w.advisory.id} ${w.advisory.title}` : ''}`);
  }
  return [...lines, ''];
}

function failureLines(failures: LicenceFailure[]): string[] {
  return failures.map((f) => `- **${f.name} ${f.version}**: ${f.reason}`);
}

function licences(): string[] {
  const lines = ['## Licences', ''];
  const npm = readNpmLicences(ROOT);
  const npmFailures = licenceFailures(npm.packages, 'npm');
  lines.push(`npm production packages: ${npm.packages.length} checked, ${npmFailures.length} not allowed.`, ...failureLines(npmFailures), '');
  if (npm.missing.length) {
    licenceFailed = true;
    lines.push(`Not installed, so their licences could not be read (run \`npm ci\`): ${npm.missing.length}.`, ...npm.missing.map((m) => `- **${m}**`), '');
  }
  const data = ASSETS.filter((a) => a.licence).map((a) => ({ name: a.id, version: a.version ?? a.status, licence: a.licence ?? undefined }));
  const dataFailures = licenceFailures(data, 'data');
  lines.push(`Data files and models: ${data.length} checked, ${dataFailures.length} not allowed.`, ...failureLines(dataFailures), '');
  const unlicensed = ASSETS.filter((a) => !a.licence).map((a) => `${a.id} (${a.status})`);
  if (unlicensed.length) lines.push(`Not checked yet (no licence recorded): ${unlicensed.join(', ')}.`, '');
  if (npmFailures.length || dataFailures.length) licenceFailed = true;

  const deny = runTool('cargo deny check licenses', TAURI);
  const note = toolNote('cargo-deny', deny);
  if (note) {
    licencesNotChecked.push('crates: cargo-deny is not installed');
    return [...lines, `Crates: ${note}`, ''];
  }
  if (deny.status !== 'ok') licenceFailed = true;
  lines.push(`Crates (\`cargo deny check licenses\`, src-tauri/deny.toml): ${deny.status === 'ok' ? 'ok' : 'FAILED'}.`, '');
  if (deny.status !== 'ok') lines.push('```', lastLines(deny.stderr, 40), '```', '');
  return lines;
}

async function main(): Promise<void> {
  const sections = [...npmOutdated(), ...cargoOutdated(), ...(await assetUpdates()), ...advisories(), ...licences()];
  const verdict = licenceVerdict(licenceFailed, licencesNotChecked);
  const report = [
    '# deps:status',
    '',
    `Generated ${new Date().toISOString().slice(0, 10)}. ${verdict}`,
    '',
    ...(warnings.length ? ['Warnings:', '', ...warnings.map((w) => `- ${w}`), ''] : []),
    ...sections,
  ].join('\n');
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, report);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  console.log(`${verdict} Report: ${path.relative(ROOT, REPORT)}`);
  if (licenceFailed) process.exitCode = 1;
}

await main();
