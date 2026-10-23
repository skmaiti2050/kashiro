/**
 * The two release configurations (Task 14 fix round 2): src-tauri/tauri.conf.json builds the full app, and
 * src-tauri/tauri.noai.conf.json merged over it builds the version without the AI helper:
 * `npx tauri build --config src-tauri/tauri.noai.conf.json`. Tauri merges a --config file as a JSON Merge
 * Patch (RFC 7396), which is what mergePatch does here, so the guard and the portable zips see what Tauri builds.
 * Developer tooling only.
 */
import fs from 'node:fs';
import path from 'node:path';

export const NOAI_CONF = 'tauri.noai.conf.json';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `target` with `patch` applied (RFC 7396): objects merge, null deletes a key, anything else replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch;
  const merged: Json = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = mergePatch(merged[key], value);
  }
  return merged;
}

/** The full config and, merged over it, the one without AI (equal to the full one when there is no override). */
export function readTauriConfigs(srcTauri: string): { full: Json; noai: Json } {
  const full = JSON.parse(fs.readFileSync(path.join(srcTauri, 'tauri.conf.json'), 'utf8')) as Json;
  const overrideFile = path.join(srcTauri, NOAI_CONF);
  const override = fs.existsSync(overrideFile) ? (JSON.parse(fs.readFileSync(overrideFile, 'utf8')) as unknown) : {};
  return { full, noai: mergePatch(full, override) as Json };
}
