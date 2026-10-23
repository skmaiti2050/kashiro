// deps/assets.json: the pinned data files and models (Task S8), read by the build scripts and deps:status.
import manifest from '../../deps/assets.json';

export interface Asset {
  id: string;
  name: string;
  version: string | null;
  /** "planned": not pinned yet (Task 12), so no hash checks. */
  status: 'pinned' | 'planned';
  sourceUrl: string | null;
  /** Where deps:status looks for a newer release; "current" is the release pinned here. */
  upstream: { kind: string; repo?: string; package?: string; dataset?: string; current?: string | null };
  licence: string | null;
  licenceNote: string;
  /** The source file the build script verifies. */
  sha256: string | null;
  /** The committed file, relative to the repository root. */
  localPath: string | null;
  outputSha256: string | null;
  buildScript: string | null;
  /** An asset of several files that are not committed (llama-server): file name → sha256, checked by its build script. */
  files?: Record<string, string>;
}

export const ASSETS = manifest.assets as Asset[];

/** The source sha256 a build script must verify; throws for an unknown or not-yet-pinned asset. */
export function pinnedSha256(id: string): string {
  const asset = ASSETS.find((a) => a.id === id);
  if (!asset) throw new Error(`No asset "${id}" in deps/assets.json.`);
  if (asset.status !== 'pinned' || !asset.sha256) throw new Error(`${id} is not pinned yet (status "${asset.status}") in deps/assets.json.`);
  return asset.sha256;
}
