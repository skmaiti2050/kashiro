import { loadDictionary } from '@/engine/dictionary/lookup';
import type * as desktop from '../platform/dictionary';

/** scripts/build-web.ts copies resources/dictionary/oewn.json.gz here, under the site's base path. */
const DICTIONARY_PATH = 'dictionary/oewn.json.gz';

/** Fetches the dictionary from Kashiro's own site (word lookup). Called on first use, only while word lookup is on. */
export const loadAppDictionary: typeof desktop.loadAppDictionary = async () => {
  const response = await fetch(`${import.meta.env.BASE_URL}${DICTIONARY_PATH}`);
  if (!response.ok) throw new Error(`The dictionary could not be downloaded (HTTP ${response.status}). Reload the page to try again.`);
  return loadDictionary(new Uint8Array(await response.arrayBuffer()));
};
