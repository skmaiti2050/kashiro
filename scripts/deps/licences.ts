/**
 * The licence allowlist (Task S8) and the npm side of the licence check. Developer tooling only: never
 * imported by the app.
 *
 * Allowlist decisions (recorded in docs/UPGRADING.md):
 * - BSD-3-Clause is listed by name: react-intl and intl-messageformat use it (owner accepted, 2026-10-22).
 * - OFL-1.1 is allowed for every package: the bundled fonts use it (owner approved).
 * - MPL-2.0 is allowed for crates only. axe-core (MPL-2.0) is a dev-only npm package, and the npm check
 *   reads production packages only, as `license-checker --production` would.
 * - CC BY-SA is allowed for data only (the frequency list and the Dakshina table).
 */
import fs from 'node:fs';
import path from 'node:path';

/** What the licensed thing is: an npm package, a Rust crate or a data file. */
export type LicenceUse = 'npm' | 'crate' | 'data';

export type LicenceVerdict = { ok: true } | { ok: false; reason: string };

export interface PackageLicence {
  name: string;
  version: string;
  /** SPDX expression as the package declares it; undefined when it declares none. */
  licence: string | undefined;
}

export type LicenceFailure = PackageLicence & { reason: string };

const ALLOWED_EVERYWHERE = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'ISC',
  'Zlib',
  'Unicode-3.0',
  'Unicode-DFS-2016',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'OFL-1.1',
]);
const ALLOWED_FOR: Record<LicenceUse, Set<string>> = {
  npm: new Set(),
  crate: new Set(['MPL-2.0']),
  data: new Set(['CC-BY-SA-3.0', 'CC-BY-SA-4.0']),
};

/** Every licence id allowed for `use` (src-tauri/deny.toml repeats the crate list). */
export const allowedLicences = (use: LicenceUse): string[] => [...ALLOWED_EVERYWHERE, ...ALLOWED_FOR[use]];

/** A non-commercial licence id: "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "LicenseRef-NonCommercial". */
const NON_COMMERCIAL = /(^|-)NC(-|$)|NonCommercial/i;
/** One token of an SPDX expression: a parenthesis or a run of anything else ("Apache-2.0", "OR"). */
const SPDX_TOKEN = /[()]|[^\s()]+/g;

/**
 * Whether `expression` (SPDX, such as "MIT OR Apache-2.0") is allowed for `use`. One allowed choice of an
 * OR is enough; every part of an AND must be allowed. "A WITH B" is read as one licence.
 */
export function checkLicence(expression: string | undefined, use: LicenceUse): LicenceVerdict {
  if (!expression?.trim()) return { ok: false, reason: 'no licence declared' };
  // Old crates write "MIT/Apache-2.0" for "MIT OR Apache-2.0".
  const tokens = expression.replace(/\//g, ' OR ').match(SPDX_TOKEN) ?? [];
  const tree = parseSpdx(tokens);
  if (!tree) return { ok: false, reason: `not a valid licence expression: ${expression}` };
  const blocked = firstBlocked(tree, (id) => ALLOWED_EVERYWHERE.has(id) || ALLOWED_FOR[use].has(id));
  if (blocked === null) return { ok: true };
  if (NON_COMMERCIAL.test(blocked)) return { ok: false, reason: `non-commercial licence: ${blocked}` };
  return { ok: false, reason: `not on the allowlist: ${blocked}` };
}

/** A parsed SPDX expression: one licence ("Apache-2.0 WITH LLVM-exception" counts as one) or an operator. */
type SpdxNode = { id: string } | { operator: 'AND' | 'OR'; left: SpdxNode; right: SpdxNode };

const SPDX_SYMBOLS = new Set(['AND', 'OR', 'WITH', '(', ')']);

/**
 * Parses the tokens (AND binds tighter than OR); undefined for a malformed expression such as "MIT OR AND",
 * so that a broken declaration never passes on its one allowed part.
 */
function parseSpdx(tokens: string[]): SpdxNode | undefined {
  let position = 0;
  let valid = true;
  const invalid = (): SpdxNode => {
    valid = false;
    return { id: '' };
  };
  const binary = (operator: 'AND' | 'OR', operand: () => SpdxNode) => (): SpdxNode => {
    let node = operand();
    while (tokens[position] === operator) {
      position++;
      node = { operator, left: node, right: operand() };
    }
    return node;
  };
  // factor = "(" expression ")" | id ["WITH" id]
  const factor = (): SpdxNode => {
    const token = tokens[position++];
    if (token === '(') {
      const inner = expression();
      return tokens[position++] === ')' ? inner : invalid();
    }
    if (token === undefined || SPDX_SYMBOLS.has(token)) return invalid();
    if (tokens[position] !== 'WITH') return { id: token };
    const exception = tokens[position + 1];
    position += 2;
    return exception === undefined || SPDX_SYMBOLS.has(exception) ? invalid() : { id: `${token} WITH ${exception}` };
  };
  const term = binary('AND', factor);
  const expression: () => SpdxNode = binary('OR', term);

  const tree = expression();
  return valid && position === tokens.length ? tree : undefined;
}

/** null when the expression is allowed, else the first licence that blocks it. */
function firstBlocked(node: SpdxNode, isAllowed: (id: string) => boolean): string | null {
  if ('id' in node) return isAllowed(node.id) ? null : node.id;
  const left = firstBlocked(node.left, isAllowed);
  const right = firstBlocked(node.right, isAllowed);
  // OR: one allowed side is enough. AND: both sides must be allowed.
  if (node.operator === 'OR') return left === null || right === null ? null : left;
  return left ?? right;
}

/** The packages whose licence `use` does not allow, with the reason. */
export function licenceFailures(packages: PackageLicence[], use: LicenceUse): LicenceFailure[] {
  const failures: LicenceFailure[] = [];
  for (const pkg of packages) {
    const verdict = checkLicence(pkg.licence, use);
    if (!verdict.ok) failures.push({ ...pkg, reason: verdict.reason });
  }
  return failures;
}

interface LockEntry {
  version?: string;
  dev?: boolean;
  link?: boolean;
}
interface PackageJson {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
}

/**
 * The production packages of the npm project at `root` (package-lock.json entries not marked dev-only), with
 * the licence each installed package.json declares, sorted by name then version. Optional packages that
 * are not installed on this machine (other platforms' binaries) are left out.
 */
export function readNpmLicences(root: string): PackageLicence[] {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, LockEntry> };
  const packages: PackageLicence[] = [];
  for (const [location, entry] of Object.entries(lock.packages)) {
    // devOptional (a dev dependency that is also an optional production one) ships, so it is checked.
    if (!location.startsWith('node_modules/') || entry.dev || entry.link) continue;
    const manifestPath = path.join(root, location, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackageJson;
    packages.push({
      name: manifest.name ?? location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: manifest.version ?? entry.version ?? '',
      licence: declaredLicence(manifest),
    });
  }
  return packages.sort((a, b) => compareText(a.name, b.name) || compareText(a.version, b.version));
}

/** "MIT", { type: "MIT" } or the old [{ type: "MIT" }, { type: "Apache-2.0" }] (read as an OR). */
function declaredLicence(manifest: PackageJson): string | undefined {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  const types = (manifest.licenses ?? []).map((l) => l.type).filter((t): t is string => Boolean(t));
  return types.length ? types.join(' OR ') : undefined;
}

/** Plain code-unit order, the same on every machine (localeCompare is not). */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
