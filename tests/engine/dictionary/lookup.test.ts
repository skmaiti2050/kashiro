import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDictionary, type Dictionary } from '@/engine/dictionary/lookup';
import type { DictionaryData } from '@/engine/dictionary/types';

const DICTIONARY_PATH = new URL('../../../resources/dictionary/oewn.json.gz', import.meta.url);
const noPersonal = { personal: new Set<string>() };

describe('dictionary lookup (real file)', () => {
  let dictionary: Dictionary;

  beforeAll(async () => {
    dictionary = await loadDictionary(new Uint8Array(readFileSync(DICTIONARY_PATH)));
  });

  const partsOfSpeech = (word: string) => dictionary.lookup(word, noPersonal).senses.map((s) => s.pos);

  it('returns verb and noun senses for affect and effect', () => {
    expect(partsOfSpeech('affect')).toEqual(expect.arrayContaining(['verb', 'noun']));
    expect(partsOfSpeech('effect')).toEqual(expect.arrayContaining(['verb', 'noun']));
  });

  it('shows an example only when it uses the word itself or an inflection (Task U3: synset examples for other words)', () => {
    const engagement = dictionary.lookup('engagement', noPersonal).senses;
    const examples = engagement.flatMap((s) => (s.example ? [s.example] : []));
    expect(engagement.length).toBeGreaterThan(examples.length); // "Grant won … battle of Chattanooga" is dropped
    for (const example of examples) expect(example).toMatch(/\bengagements?\b/i);
    // Inflections count: "ran" for run, "studies" for study.
    const run = dictionary.lookup('run', noPersonal).senses.flatMap((s) => (s.example ? [s.example] : []));
    expect(run.length).toBeGreaterThan(0);
    for (const example of run) expect(example).toMatch(/\b(run|runs|ran|running)\b/i);
    // A base form's senses are judged by the base form: "saw" shows "see" examples.
    const saw = dictionary.lookup('saw', noPersonal).senses.filter((s) => s.formOf === 'see' && s.example);
    for (const sense of saw) expect(sense.example).toMatch(/\b(see|sees|saw|seen|seeing)\b/i);
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

  it("shows a headword own senses first, then the base form senses marked formOf", () => {
    const saw = dictionary.lookup('saw', noPersonal);
    expect(saw.lemma).toBe('see');
    expect(saw.senses[0].formOf).toBeUndefined();
    expect(saw.senses[0].pos).toBe("noun");
    expect(saw.senses.some((sense) => /teeth|cutting/i.test(sense.definition) && !sense.formOf)).toBe(true);
    expect(saw.senses.some((sense) => sense.formOf === 'see' && sense.pos === 'verb')).toBe(true);

    const left = dictionary.lookup('left', noPersonal);
    expect(left.senses[0].formOf).toBeUndefined();
    expect(left.senses.some((sense) => /direction|side/i.test(sense.definition) && !sense.formOf)).toBe(true);
    expect(left.senses.some((sense) => sense.formOf === 'leave')).toBe(true);
  });

  it.each(['news', 'paper', 'number'])('does not treat the headword %s as an inflection', (word) => {
    const result = dictionary.lookup(word, noPersonal);
    expect(result.lemma).toBe(word);
    expect(result.senses.length).toBeGreaterThan(0);
    expect(result.senses.some((sense) => sense.formOf)).toBe(false);
  });

  it('marks no sense as a form for a plain headword', () => {
    expect(dictionary.lookup('effect', noPersonal).senses.some((sense) => sense.formOf)).toBe(false);
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
  // The load and lookup timing tests live in tests/timing (run on their own, after the rest of the suite).
});

// Web Task 7 fix: a host that serves oewn.json.gz with Content-Encoding: gzip (Vite preview, Cloudflare) has the
// browser decompress it, so the bytes Kashiro gets are already JSON.
describe('loading the dictionary file', () => {
  const data: DictionaryData = { format: 1, entries: { cat: [['n', 'a small feline', '', ['puss']]] }, exceptions: {} };
  const json = new TextEncoder().encode(JSON.stringify(data));
  const lookupCat = async (bytes: Uint8Array) => (await loadDictionary(bytes)).lookup('cats', noPersonal);

  it('reads the gzipped file', async () => {
    const result = await lookupCat(new Uint8Array(gzipSync(json)));
    expect(result.lemma).toBe('cat');
    expect(result.senses).toEqual([{ pos: 'noun', definition: 'a small feline', synonyms: ['puss'], formOf: 'cat' }]);
  });

  it('reads the same file already decompressed, with the same result', async () => {
    expect(await lookupCat(json)).toEqual(await lookupCat(new Uint8Array(gzipSync(json))));
  });

  it('says the file is damaged when it is neither gzip nor JSON', async () => {
    await expect(loadDictionary(new TextEncoder().encode('<html>Not found</html>'))).rejects.toThrow(
      /dictionary file is damaged/,
    );
  });
});
