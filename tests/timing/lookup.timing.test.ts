// Timing tests run in their own vitest project, one file at a time after the other tests (vitest.config.ts).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDictionary, type Dictionary } from '@/engine/dictionary/lookup';

const DICTIONARY_PATH = new URL('../../resources/dictionary/oewn.json.gz', import.meta.url);
const noPersonal = { personal: new Set<string>() };

describe('dictionary lookup timing (real file)', () => {
  let dictionary: Dictionary;
  let loadAndFirstLookupMs = 0;

  beforeAll(async () => {
    const start = performance.now();
    dictionary = await loadDictionary(new Uint8Array(readFileSync(DICTIONARY_PATH)));
    dictionary.lookup('affect', noPersonal);
    loadAndFirstLookupMs = performance.now() - start;
  });

  // Target is 300 ms (about 230-265 ms when run alone); 3 s only guards against a gross regression on a
  // slower machine.
  it('loads and answers the first lookup in under 3 s', () => {
    expect(loadAndFirstLookupMs).toBeLessThan(3000);
  });

  it('answers a lookup in under 50 ms', () => {
    const start = performance.now();
    dictionary.lookup('studies', noPersonal);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
