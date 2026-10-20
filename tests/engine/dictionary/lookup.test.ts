import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDictionary, type Dictionary } from '@/engine/dictionary/lookup';

const DICTIONARY_PATH = new URL('../../../resources/dictionary/oewn.json.gz', import.meta.url);
const noPersonal = { personal: new Set<string>() };

describe('dictionary lookup (real file)', () => {
  let dictionary: Dictionary;
  let loadAndFirstLookupMs = 0;

  beforeAll(async () => {
    const start = performance.now();
    dictionary = await loadDictionary(new Uint8Array(readFileSync(DICTIONARY_PATH)));
    dictionary.lookup('affect', noPersonal);
    loadAndFirstLookupMs = performance.now() - start;
  });

  const partsOfSpeech = (word: string) => dictionary.lookup(word, noPersonal).senses.map((s) => s.pos);

  it('returns verb and noun senses for affect and effect', () => {
    expect(partsOfSpeech('affect')).toEqual(expect.arrayContaining(['verb', 'noun']));
    expect(partsOfSpeech('effect')).toEqual(expect.arrayContaining(['verb', 'noun']));
  });

  it('gives each sense a definition and string synonyms', () => {
    const sense = dictionary.lookup('effect', noPersonal).senses[0];
    expect(sense.definition.length).toBeGreaterThan(5);
    expect(sense.synonyms.every((s) => typeof s === 'string')).toBe(true);
  });

  it.each([
    ['running', 'run'],
    ['studies', 'study'],
    ['better', 'good'],
    ['geese', 'goose'],
    ['walked', 'walk'],
    ['happier', 'happy'],
  ])('maps %s to its lemma %s', (word, lemma) => {
    const result = dictionary.lookup(word, noPersonal);
    expect(result.lemma).toBe(lemma);
    expect(result.senses.length).toBeGreaterThan(0);
  });

  it('is case-insensitive and keeps the word as typed', () => {
    const result = dictionary.lookup('Running', noPersonal);
    expect(result.word).toBe('Running');
    expect(result.lemma).toBe('run');
  });

  it('returns no senses for an unknown word', () => {
    const result = dictionary.lookup('qzxvbn', noPersonal);
    expect(result.senses).toEqual([]);
    expect(result.lemma).toBe('qzxvbn');
  });

  it('flags Indian-English words and personal-dictionary words', () => {
    expect(dictionary.lookup('panchayat', noPersonal).inIndianEnglishList).toBe(true);
    expect(dictionary.lookup('effect', noPersonal).inIndianEnglishList).toBe(false);
    expect(dictionary.lookup('Zorblax', { personal: new Set(['zorblax']) }).inPersonalDictionary).toBe(true);
    expect(dictionary.lookup('zorblax', noPersonal).inPersonalDictionary).toBe(false);
  });

  // The target is 300 ms (about 230 ms when run alone); the suite runs files in parallel, so this guards
  // against a regression with headroom for a loaded machine.
  it('loads and answers the first lookup in under 1 s', () => {
    expect(loadAndFirstLookupMs).toBeLessThan(1000);
  });

  it('answers a lookup in under 5 ms', () => {
    const start = performance.now();
    dictionary.lookup('studies', noPersonal);
    expect(performance.now() - start).toBeLessThan(5);
  });
});
