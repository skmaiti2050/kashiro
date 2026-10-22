import { resolveResource } from '@tauri-apps/api/path';
import { readFile } from '@tauri-apps/plugin-fs';
import { loadDictionary, type Dictionary } from '@/engine/dictionary/lookup';

/** Where tauri.conf.json's bundle.resources puts the dictionary; the capability lets the app read this one file. */
const DICTIONARY_RESOURCE = 'dictionary/oewn.json.gz';

/** Reads the dictionary bundled with the app (word lookup). Called on first use, only while word lookup is on. */
export async function loadAppDictionary(): Promise<Dictionary> {
  const path = await resolveResource(DICTIONARY_RESOURCE);
  return loadDictionary(await readFile(path));
}
