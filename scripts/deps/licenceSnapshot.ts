/**
 * The licence snapshot (Task S8): every production npm package and every crate in Cargo.lock with its
 * declared licence, sorted. Written to deps/snapshots/licences.json; upgrade:check reports its diff.
 */
import { spawnSync } from 'node:child_process';
import { compareText, type PackageLicence } from './licences';

/** The parts of `cargo metadata --format-version 1` this needs. */
export interface CargoMetadata {
  workspace_members: string[];
  packages: { id: string; name: string; version: string; license: string | null }[];
}

export interface LicenceSnapshot {
  /** "name@version" -> SPDX expression ("(none)" when the package declares none). */
  npm: Record<string, string>;
  crates: Record<string, string>;
}

/** The crates of the Rust project (the project itself left out), as package licences. */
export function crateLicences(metadata: CargoMetadata): PackageLicence[] {
  const own = new Set(metadata.workspace_members);
  return metadata.packages
    .filter((p) => !own.has(p.id))
    .map((p) => ({ name: p.name, version: p.version, licence: p.license ?? undefined }));
}

export function buildLicenceSnapshot(npm: PackageLicence[], metadata: CargoMetadata): LicenceSnapshot {
  const byKey = (packages: PackageLicence[]) =>
    Object.fromEntries(
      packages
        .map((p) => [`${p.name}@${p.version}`, p.licence ?? '(none)'] as const)
        .sort(([a], [b]) => compareText(a, b)),
    );
  return { npm: byKey(npm), crates: byKey(crateLicences(metadata)) };
}

/** `cargo metadata` for the project in `manifestDir`, offline and from Cargo.lock as committed. */
export function readCargoMetadata(manifestDir: string): CargoMetadata {
  const result = spawnSync('cargo', ['metadata', '--format-version', '1', '--locked', '--offline'], {
    cwd: manifestDir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`cargo metadata failed in ${manifestDir}: ${result.stderr || result.error?.message}`);
  return JSON.parse(result.stdout) as CargoMetadata;
}
