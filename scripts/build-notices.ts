/**
 * `npm run build:notices` (Task 14): writes resources/notices/THIRD-PARTY-NOTICES.txt, the licence texts of
 * the code that ships inside the app: the npm production packages (bundled into the web pages) and the crates
 * compiled into writing-check.exe. Offline: it reads the installed packages and `cargo metadata --offline`.
 * The data files, fonts, Harper and llama.cpp have their own ATTRIBUTION.md files under resources/.
 *
 * Run it after any dependency upgrade and commit the result; tests/scripts/build-notices.test.ts checks that
 * the file names the installed versions.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareText } from './deps/licences';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NOTICES_FILE = 'resources/notices/THIRD-PARTY-NOTICES.txt';
/** The only target the app is built for (v1.0 is Windows-only). */
const TARGET = 'x86_64-pc-windows-msvc';
/** A licence file in a package's root folder: "LICENSE", "LICENSE-MIT", "LICENCE.txt", "COPYING", "NOTICE.md". */
const LICENCE_FILE = /^(licen[cs]e|copying|notice)/i;
const RULE = '='.repeat(78);

export interface PackageNotice {
  name: string;
  version: string;
  licence?: string;
  /** The package's licence files, in file-name order; empty when it ships none. */
  texts: string[];
}

/** The texts of the licence files in a package folder, line ends made plain and trailing space trimmed. */
export function licenceTextsIn(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareText)
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n').trimEnd());
}

const label = (p: PackageNotice) => `${p.name} ${p.version} (${p.licence ?? 'no licence declared'})`;

/**
 * The notices file: each distinct set of licence texts once, under the packages that ship it (many crates share
 * the same Apache-2.0 and MIT files), then the packages that ship no licence file, with their declared licence.
 */
export function formatThirdPartyNotices(packages: PackageNotice[]): string {
  const sorted = [...packages].sort((a, b) => compareText(a.name, b.name) || compareText(a.version, b.version));
  const groups = new Map<string, PackageNotice[]>();
  for (const p of sorted.filter((p) => p.texts.length > 0)) {
    const key = p.texts.join('\n\n');
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const sections = [...groups].map(([text, group]) => `${RULE}\n${group.map(label).join('\n')}\n\n${text}\n`);
  const withoutFile = sorted.filter((p) => p.texts.length === 0).map(label);
  if (withoutFile.length) {
    sections.push(`${RULE}\nThese packages ship no licence file; each is used under the licence it declares:\n\n${withoutFile.join('\n')}\n`);
  }
  const header = [
    'Third-party notices for writing-check',
    '',
    'The libraries built into writing-check: the JavaScript packages in its window and the Rust crates in',
    'writing-check.exe. The word data, fonts, Harper and llama.cpp have their own notice files in this folder;',
    'the Microsoft Visual C++ runtime bundled with the AI helper is covered in llama-cpp.md.',
    'The source code of every crate listed here, including the MPL-2.0 ones, is published unmodified on',
    'crates.io at the version shown; the npm packages are published on npmjs.com.',
    '',
  ].join('\n');
  return `${header}\n${sections.join('\n')}`;
}

interface LockEntry {
  version?: string;
  dev?: boolean;
  optional?: boolean;
  link?: boolean;
}

/** The installed npm production packages (as in scripts/deps/licences.ts: lock entries not marked dev-only). */
function npmNotices(root: string): PackageNotice[] {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, LockEntry> };
  const notices: PackageNotice[] = [];
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location.startsWith('node_modules/') || entry.dev || entry.link) continue;
    const dir = path.join(root, location);
    if (!fs.existsSync(path.join(dir, 'package.json'))) {
      if (entry.optional) continue;
      throw new Error(`${location} is not installed: run npm ci first.`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
    notices.push({ name: manifest.name, version: manifest.version, licence: manifest.license, texts: licenceTextsIn(dir) });
  }
  return notices;
}

/** The parts of `cargo metadata` this needs: the resolved graph, filtered to the target. */
export interface CrateGraph {
  root: string;
  nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[];
}
interface CargoMetadata {
  packages: { id: string; name: string; version: string; license: string | null; manifest_path: string }[];
  resolve: CrateGraph;
}

/** The crates compiled into the app: everything reachable from it through normal (not build or dev) dependencies. */
export function shippedCrates(graph: CrateGraph): Set<string> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const shipped = new Set<string>();
  const queue = [graph.root];
  while (queue.length > 0) {
    for (const dep of byId.get(queue.shift()!)?.deps ?? []) {
      if (shipped.has(dep.pkg) || !dep.dep_kinds.some((k) => k.kind === null)) continue;
      shipped.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }
  return shipped;
}

function crateNotices(manifestDir: string): PackageNotice[] {
  const result = spawnSync('cargo', ['metadata', '--format-version', '1', '--locked', '--offline', '--filter-platform', TARGET], {
    cwd: manifestDir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`cargo metadata failed in ${manifestDir}: ${result.stderr || result.error?.message}`);
  const metadata = JSON.parse(result.stdout) as CargoMetadata;
  const shipped = shippedCrates(metadata.resolve);
  return metadata.packages
    .filter((p) => shipped.has(p.id))
    .map((p) => ({ name: p.name, version: p.version, licence: p.license ?? undefined, texts: licenceTextsIn(path.dirname(p.manifest_path)) }));
}

/** Every package the notices cover, read from the project at `root`. */
const shippedPackages = (root: string): PackageNotice[] => [...npmNotices(root), ...crateNotices(path.join(root, 'src-tauri'))];

/**
 * Lines saying the committed notices file differs from what the installed packages give now; empty when it is
 * current. upgrade:check runs this after every upgrade.
 */
export function staleNotices(root: string): string[] {
  const file = path.join(root, NOTICES_FILE);
  const committed = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (committed === formatThirdPartyNotices(shippedPackages(root))) return [];
  return [`${NOTICES_FILE} is out of date: run npm run build:notices and commit it`];
}

function main(): void {
  const packages = shippedPackages(ROOT);
  const file = path.join(ROOT, NOTICES_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, formatThirdPartyNotices(packages));
  const withoutFile = packages.filter((p) => p.texts.length === 0).length;
  console.log(`Wrote ${NOTICES_FILE}: ${packages.length} packages, ${withoutFile} without a licence file.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
