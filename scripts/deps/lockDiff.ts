/**
 * What an upgrade changed in a lockfile (Task S8, first real run): packages added, removed or at another
 * version, and dependency edges re-pointed in packages that did not change themselves ("cssparser-macros
 * 0.7.1: syn 3.0.9 -> 2.0.119"). Reads Cargo.lock and package-lock.json (v2/v3) into the same graph.
 */
import { compareText } from './licences';

interface LockNode {
  name: string;
  version: string;
  /** Dependency name -> the versions it resolves to (npm nesting can give one name two). */
  deps: Map<string, Set<string>>;
}

/** Nodes by "name@version". */
export type LockGraph = Map<string, LockNode>;

export interface LockChange {
  /** The package the change belongs to, as `--expect` names it. */
  name: string;
  text: string;
}

function addNode(graph: LockGraph, name: string, version: string): LockNode {
  const key = `${name}@${version}`;
  const node = graph.get(key) ?? { name, version, deps: new Map() };
  graph.set(key, node);
  return node;
}

function addEdge(node: LockNode, depName: string, depVersion: string): void {
  const versions = node.deps.get(depName) ?? new Set<string>();
  versions.add(depVersion);
  node.deps.set(depName, versions);
}

/** One [[package]] block's name, version and dependency lines ("syn 2.0.119", "bytes"). */
const CARGO_NAME = /^name = "([^"]+)"$/m;
const CARGO_VERSION = /^version = "([^"]+)"$/m;
const CARGO_DEPENDENCIES = /^dependencies = \[([^\]]*)\]/m;
/** One dependency entry: "syn 2.0.119 (registry+...)" or "bytes". */
const CARGO_DEPENDENCY = /"([^" ]+)(?: ([^" ]+))?[^"]*"/g;

export function cargoLockGraph(text: string): LockGraph {
  const blocks = text.split('[[package]]').slice(1).map((block) => ({
    name: CARGO_NAME.exec(block)?.[1] ?? '',
    version: CARGO_VERSION.exec(block)?.[1] ?? '',
    deps: [...(CARGO_DEPENDENCIES.exec(block)?.[1] ?? '').matchAll(CARGO_DEPENDENCY)].map((m) => ({ name: m[1], version: m[2] })),
  }));
  // Cargo writes a dependency's version only when the lock holds more than one version of it.
  const versionsOf = new Map<string, string[]>();
  for (const b of blocks) versionsOf.set(b.name, [...(versionsOf.get(b.name) ?? []), b.version]);
  const graph: LockGraph = new Map();
  for (const block of blocks) {
    const node = addNode(graph, block.name, block.version);
    for (const dep of block.deps) addEdge(node, dep.name, dep.version ?? versionsOf.get(dep.name)?.[0] ?? '?');
  }
  return graph;
}

interface NpmEntry {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const NODE_MODULES = 'node_modules/';
const npmName = (location: string) => location.slice(location.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);

/** Where node finds `dep` from `location`: its own node_modules, then each parent's, then the root's. */
function resolveNpm(packages: Record<string, NpmEntry>, location: string, dep: string): string | undefined {
  let base = location;
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}${NODE_MODULES}${dep}`;
    if (packages[candidate]) return candidate;
    if (!base) return undefined;
    const parent = base.lastIndexOf(`/${NODE_MODULES}`);
    base = parent < 0 ? '' : base.slice(0, parent);
  }
}

export function npmLockGraph(text: string): LockGraph {
  const { packages } = JSON.parse(text) as { packages: Record<string, NpmEntry> };
  const graph: LockGraph = new Map();
  for (const [location, entry] of Object.entries(packages)) {
    const node = addNode(graph, location ? npmName(location) : (entry.name ?? '(root)'), entry.version ?? '');
    const deps = { ...entry.peerDependencies, ...entry.optionalDependencies, ...entry.devDependencies, ...entry.dependencies };
    for (const dep of Object.keys(deps)) {
      const resolved = resolveNpm(packages, location, dep);
      if (resolved) addEdge(node, dep, packages[resolved].version ?? '');
    }
  }
  return graph;
}

const versionList = (versions: Iterable<string>) => [...versions].sort(compareText).join(', ');

function versionsByName(graph: LockGraph): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>();
  for (const node of graph.values()) byName.set(node.name, (byName.get(node.name) ?? new Set()).add(node.version));
  return byName;
}

/**
 * The changes from `before` to `after`, sorted. An edge that moved because its target package changed
 * version is that package's change, so it is not listed again.
 */
export function diffLockGraphs(before: LockGraph, after: LockGraph): LockChange[] {
  const changes: LockChange[] = [];
  const [oldVersions, newVersions] = [versionsByName(before), versionsByName(after)];
  const changedNames = new Set<string>();
  for (const name of new Set([...oldVersions.keys(), ...newVersions.keys()])) {
    const [was, now] = [oldVersions.get(name), newVersions.get(name)];
    if (was && now && versionList(was) === versionList(now)) continue;
    changedNames.add(name);
    const text = !was ? `${name}: added ${versionList(now!)}` : !now ? `${name}: removed ${versionList(was)}` : `${name}: ${versionList(was)} -> ${versionList(now)}`;
    changes.push({ name, text });
  }
  for (const [key, node] of after) {
    const old = before.get(key);
    if (!old) continue;
    for (const dep of new Set([...old.deps.keys(), ...node.deps.keys()])) {
      if (changedNames.has(dep)) continue;
      const [was, now] = [old.deps.get(dep), node.deps.get(dep)];
      if (was && now && versionList(was) === versionList(now)) continue;
      const owner = `${node.name} ${node.version}`.trimEnd();
      const text = !was ? `${owner}: adds ${dep} ${versionList(now!)}` : !now ? `${owner}: drops ${dep} ${versionList(was)}` : `${owner}: ${dep} ${versionList(was)} -> ${versionList(now)}`;
      changes.push({ name: node.name, text });
    }
  }
  return changes.sort((a, b) => compareText(a.text, b.text));
}

/** The changes that belong to none of the `expected` packages (upgrade:check --expect). */
export function changesOutside(changes: LockChange[], expected: string[]): LockChange[] {
  return changes.filter((change) => !expected.includes(change.name));
}
