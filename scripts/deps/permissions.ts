/**
 * What the app is allowed to reach or do, read from src-tauri/tauri.conf.json and the capability files,
 * and the check that an upgrade never widens it (Task S8). Developer tooling only.
 *
 * The baseline is the committed file deps/snapshots/permissions.json, not git HEAD: a widening committed
 * to tauri.conf.json still fails until someone runs `npm run deps:accept-permissions` and commits the
 * baseline's diff, which a reviewer then sees.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseCapabilityToml } from './capabilityToml';

const CONF_PATH = 'src-tauri/tauri.conf.json';
const CAPABILITIES_DIR = 'src-tauri/capabilities';
export const PERMISSION_BASELINE = 'deps/snapshots/permissions.json';
/** Capability files Tauri reads. */
const CAPABILITY_FILE = /\.(json|toml)$/;

/** The permission surface in the working tree, as the next build would ship it. */
export function readWorkingSurface(root: string): PermissionSurface {
  const dir = path.join(root, CAPABILITIES_DIR);
  const capabilityFiles: Record<string, string> = {};
  for (const file of fs.readdirSync(dir).filter((f) => CAPABILITY_FILE.test(f)).sort()) {
    capabilityFiles[file] = fs.readFileSync(path.join(dir, file), 'utf8');
  }
  return readPermissionSurface(fs.readFileSync(path.join(root, CONF_PATH), 'utf8'), capabilityFiles);
}

/** The committed baseline, or undefined when there is none. */
export function readPermissionBaseline(root: string): PermissionSurface | undefined {
  const file = path.join(root, PERMISSION_BASELINE);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as PermissionSurface) : undefined;
}

/** The baseline file's text, as `npm run deps:accept-permissions` writes it. */
export const formatPermissionBaseline = (surface: PermissionSurface): string => `${JSON.stringify(surface, null, 2)}\n`;

/** Every widening of the working tree against the committed baseline; a missing baseline fails too. */
export function checkPermissions(root: string): string[] {
  const baseline = readPermissionBaseline(root);
  if (!baseline) return [`no permissions baseline (${PERMISSION_BASELINE}): run npm run deps:accept-permissions`];
  return findWidenings(baseline, readWorkingSurface(root));
}

/** A CSP as directive -> sources: { "connect-src": ["'self'", "ipc:"] }. */
type Csp = Record<string, string[]>;

export interface PermissionSurface {
  /** The production and development CSPs; null when the config sets none. */
  csp: { csp: Csp | null; devCsp: Csp | null };
  /** Capability identifier -> its windows, webviews, remote URLs, permissions, platforms and local access, one string each. */
  capabilities: Record<string, string[]>;
  /** Other settings that can open the app up, as JSON text: "app.security.freezePrototype" -> "true". */
  settings: Record<string, string>;
}

interface TauriConf {
  app?: { security?: Record<string, unknown>; withGlobalTauri?: unknown };
  bundle?: { externalBin?: unknown };
  plugins?: unknown;
}
interface Capability {
  identifier?: string;
  windows?: string[];
  webviews?: string[];
  remote?: { urls?: string[] };
  permissions?: unknown[];
  /** Absent: every platform. */
  platforms?: string[];
  /** Absent: true (the app's own pages get the permissions). */
  local?: boolean;
}

const CSP_KEYS = ['csp', 'devCsp'] as const;

/** `capabilityFiles` maps each capability file name (.json or .toml) to its text. */
export function readPermissionSurface(confJson: string, capabilityFiles: Record<string, string>): PermissionSurface {
  const conf = JSON.parse(confJson) as TauriConf;
  const security = conf.app?.security ?? {};
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(security)) {
    if (!(CSP_KEYS as readonly string[]).includes(key)) settings[`app.security.${key}`] = JSON.stringify(value);
  }
  const optional = { 'app.withGlobalTauri': conf.app?.withGlobalTauri, 'bundle.externalBin': conf.bundle?.externalBin, plugins: conf.plugins };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) settings[key] = JSON.stringify(value);

  const capabilities: Record<string, string[]> = {};
  for (const [fileName, text] of Object.entries(capabilityFiles)) {
    const capability = (fileName.endsWith('.toml') ? parseCapabilityToml(text) : JSON.parse(text)) as Capability;
    capabilities[capability.identifier ?? fileName] = [
      ...(capability.windows ?? []).map((w) => `window ${w}`),
      ...(capability.webviews ?? []).map((w) => `webview ${w}`),
      ...(capability.remote?.urls ?? []).map((url) => `remote ${url}`),
      ...(capability.permissions ?? []).map((p) => (typeof p === 'string' ? p : JSON.stringify(p))),
      ...(capability.platforms ? capability.platforms.map((p) => `platform ${p}`) : ['platforms all']),
      `local ${capability.local ?? true}`,
    ];
  }
  return { csp: { csp: parseCsp(security.csp), devCsp: parseCsp(security.devCsp) }, capabilities, settings };
}

/** Tauri takes a CSP as one string or as { directive: "sources" | ["sources"] }. */
function parseCsp(value: unknown): Csp | null {
  if (value === null || value === undefined) return null;
  const csp: Csp = {};
  if (typeof value === 'string') {
    for (const part of value.split(';')) {
      const [directive, ...sources] = part.trim().split(/\s+/);
      if (directive) csp[directive] = sources;
    }
    return csp;
  }
  for (const [directive, sources] of Object.entries(value as Record<string, string | string[]>)) {
    csp[directive] = Array.isArray(sources) ? sources : sources.split(/\s+/).filter(Boolean);
  }
  return csp;
}

/**
 * Every way `current` allows more than `baseline`, one line each; empty when nothing widened. Narrowing
 * (a source or permission removed) is allowed; a removed CSP directive is not, since it falls back to
 * default-src. Any change to another security setting counts, because it has to be read by a person.
 */
export function findWidenings(baseline: PermissionSurface, current: PermissionSurface): string[] {
  const widenings: string[] = [];
  for (const key of CSP_KEYS) widenings.push(...cspWidenings(key, baseline.csp[key], current.csp[key]));
  for (const [id, entries] of Object.entries(current.capabilities)) {
    const before = new Set(baseline.capabilities[id] ?? []);
    for (const entry of entries) {
      // A platform list where every platform was allowed is a narrowing.
      const coveredByAll = entry.startsWith('platform ') && before.has('platforms all');
      if (!before.has(entry) && !coveredByAll) widenings.push(`capability ${id} adds ${entry}`);
    }
  }
  const keys = new Set([...Object.keys(baseline.settings), ...Object.keys(current.settings)]);
  for (const key of keys) {
    const [before, after] = [baseline.settings[key] ?? '(none)', current.settings[key] ?? '(none)'];
    if (before !== after) widenings.push(`${key} changed: ${before} -> ${after}`);
  }
  return widenings;
}

function cspWidenings(name: string, baseline: Csp | null, current: Csp | null): string[] {
  if (!baseline) return [];
  if (!current) return [`${name} removed`];
  const widenings: string[] = [];
  for (const directive of Object.keys(baseline)) {
    if (!(directive in current)) widenings.push(`${name} drops ${directive}`);
  }
  for (const [directive, sources] of Object.entries(current)) {
    const before = new Set(baseline[directive] ?? []);
    for (const source of sources) if (!before.has(source)) widenings.push(`${name} ${directive} adds ${source}`);
  }
  return widenings;
}
