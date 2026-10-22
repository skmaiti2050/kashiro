// Task 11b UI: the word lookup's state (the panel's loading / result / failure) and which word a selection means.
import { gzipSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { loadDictionary, type Dictionary, type Sense } from '@/engine/dictionary/lookup';
import type { DictionaryData } from '@/engine/dictionary/types';
import { sensesToShow, WordLookup, wordLanguage, wordsToCompare, wordToLookUp } from '@/ui/state/wordLookup';

const DATA: DictionaryData = {
  format: 1,
  entries: {
    receive: [['v', 'get something; come into possession of', 'receive gifts', ['have', 'get']]],
    affect: [
      ['v', 'have an effect upon', '', ['impact', 'bear upon']],
      ['n', 'the conscious subjective aspect of feeling or emotion', '', []],
    ],
  },
  exceptions: {},
};

const dictionaryFile = () => loadDictionary(new Uint8Array(gzipSync(JSON.stringify(DATA))));

/** A promise and its resolve/reject, to hold a load in progress. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function lookupWith(dictionary: () => Promise<Dictionary> | null, personal: string[] = []) {
  return new WordLookup({ dictionary, personalWords: () => personal });
}

describe('wordToLookUp: the word a selection or caret means', () => {
  const text = 'The quick fox, well-known and don’t-care, jumps.';

  it('a caret inside, before or right after a word gives that word', () => {
    expect(wordToLookUp(text, text.indexOf('quick') + 2, text.indexOf('quick') + 2)).toBe('quick');
    expect(wordToLookUp(text, text.indexOf('quick'), text.indexOf('quick'))).toBe('quick');
    expect(wordToLookUp(text, text.indexOf('fox') + 3, text.indexOf('fox') + 3)).toBe('fox');
  });

  it('keeps hyphens and apostrophes inside a word', () => {
    expect(wordToLookUp(text, text.indexOf('known'), text.indexOf('known'))).toBe('well-known');
    expect(wordToLookUp(text, text.indexOf('don'), text.indexOf('don'))).toBe('don’t-care');
  });

  it('a caret with no word next to it gives null', () => {
    expect(wordToLookUp('a  ,  b', 3, 3)).toBeNull();
    expect(wordToLookUp('', 0, 0)).toBeNull();
  });

  it('a selection is used as selected, without the spaces and punctuation around it', () => {
    expect(wordToLookUp(text, text.indexOf('fox'), text.indexOf(' well'))).toBe('fox');
    expect(wordToLookUp(text, text.indexOf('quick') - 1, text.indexOf('quick') + 5)).toBe('quick');
    // A selection inside a word is that part only: the user chose it.
    expect(wordToLookUp(text, text.indexOf('well'), text.indexOf('well') + 4)).toBe('well');
  });

  it('a selection of several words is looked up as a phrase; one of only punctuation gives null', () => {
    expect(wordToLookUp(text, text.indexOf('quick'), text.indexOf(','))).toBe('quick fox');
    expect(wordToLookUp(text, text.indexOf(','), text.indexOf(',') + 2)).toBeNull();
  });

  it('a long selection (more than a short phrase) gives null rather than a sentence', () => {
    const long = 'word '.repeat(20);
    expect(wordToLookUp(long, 0, long.length)).toBeNull();
  });

  it('works on letters outside a–z (é, Devanagari) and a caret at a surrogate pair', () => {
    expect(wordToLookUp('a café here', 4, 4)).toBe('café');
    expect(wordToLookUp('यह किताब है', 4, 4)).toBe('किताब');
    expect(wordToLookUp('😀 smile', 1, 1)).toBeNull();
  });
});

describe('wordsToCompare: what a review item’s Look up shows', () => {
  it('the original word and its first suggestion', () => {
    expect(wordsToCompare('recieve', 'receive')).toEqual(['recieve', 'receive']);
  });

  it('only the original when there is no suggestion, it is a deletion, or it is the same word', () => {
    expect(wordsToCompare('very', undefined)).toEqual(['very']);
    expect(wordsToCompare('very', '')).toEqual(['very']);
    expect(wordsToCompare('Colour', 'Colour')).toEqual(['Colour']);
  });

  it('the suggestion without its punctuation; a phrase suggestion is still shown', () => {
    expect(wordsToCompare('alot', 'a lot')).toEqual(['alot', 'a lot']);
    expect(wordsToCompare('its', 'it’s,')).toEqual(['its', 'it’s']);
  });

  it('null when the original is not one word (a phrase or a sentence to rewrite)', () => {
    expect(wordsToCompare('could of', 'could have')).toBeNull();
    expect(wordsToCompare('  ', 'x')).toBeNull();
  });
});

describe('sensesToShow: up to 3, spread across parts of speech', () => {
  const sense = (pos: Sense['pos'], definition: string): Sense => ({ pos, definition, synonyms: [] });
  const affect = [sense('verb', 'v1'), sense('verb', 'v2'), sense('verb', 'v3'), sense('noun', 'n1'), sense('noun', 'n2')];

  it('one per part of speech first, then the next senses, in the dictionary’s order', () => {
    expect(sensesToShow(affect, 3).map((s) => s.definition)).toEqual(['v1', 'v2', 'n1']);
    expect(sensesToShow(affect, 2).map((s) => s.definition)).toEqual(['v1', 'n1']);
  });

  it('a single part of speech keeps its first senses; fewer senses than slots shows them all', () => {
    expect(sensesToShow(affect.slice(0, 3), 2).map((s) => s.definition)).toEqual(['v1', 'v2']);
    expect(sensesToShow([sense('adverb', 'r1')], 3).map((s) => s.definition)).toEqual(['r1']);
  });

  it('on the real data shape: "affect" shows its verb and noun senses', async () => {
    const result = (await dictionaryFile()).lookup('affect', { personal: new Set() });
    expect(sensesToShow(result.senses, 1).map((s) => s.pos)).toEqual(['verb']);
    expect(new Set(sensesToShow(result.senses, 3).map((s) => s.pos))).toEqual(new Set(['verb', 'noun']));
  });
});

describe('wordLanguage: the lang of a looked-up word', () => {
  it('English for Latin letters (with marks, hyphens, apostrophes, digits)', () => {
    expect(['receive', 'café', 'well-known', 'don’t', 'COVID-19'].map(wordLanguage)).toEqual(['en', 'en', 'en', 'en', 'en']);
  });

  it('none for other scripts, so a screen reader does not read किताब as English', () => {
    expect(wordLanguage('किताब')).toBeUndefined();
    expect(wordLanguage('বই')).toBeUndefined();
  });
});

describe('WordLookup', () => {
  it('shows loading, then the result for each word, and announces "Definition loaded"', async () => {
    const loading = deferred<Dictionary>();
    const lookup = lookupWith(() => loading.promise);
    const done = lookup.open(['recieve', 'receive']);
    expect(lookup.getState()).toMatchObject({ words: ['recieve', 'receive'], status: 'loading', results: [], error: null });
    loading.resolve(await dictionaryFile());
    await done;
    const state = lookup.getState()!;
    expect(state.status).toBe('ready');
    expect(state.results.map((r) => [r.word, r.senses.length])).toEqual([
      ['recieve', 0],
      ['receive', 1],
    ]);
    expect(state.announcement?.message).toEqual({ key: 'lookup.loaded' });
  });

  it('announces "No definition found" when no word has a sense', async () => {
    const dictionary = await dictionaryFile();
    const lookup = lookupWith(() => Promise.resolve(dictionary));
    await lookup.open(['zzyzx']);
    expect(lookup.getState()?.announcement?.message).toEqual({ key: 'lookup.noneFound' });
  });

  it('marks a word in the personal dictionary', async () => {
    const dictionary = await dictionaryFile();
    const lookup = lookupWith(() => Promise.resolve(dictionary), ['Wadgaon']);
    await lookup.open(['Wadgaon']);
    expect(lookup.getState()?.results[0].inPersonalDictionary).toBe(true);
  });

  it('word lookup switched off (no dictionary): a clear failure, nothing loaded', async () => {
    const lookup = lookupWith(() => null);
    await lookup.open(['affect']);
    // The panel shows the error in an alert, which is read out; no second announcement.
    expect(lookup.getState()).toMatchObject({ status: 'failed', error: { key: 'lookup.unavailable' }, announcement: null });
  });

  it('a failed load shows why and what to do', async () => {
    const lookup = lookupWith(() => Promise.reject(new Error('resource not found')));
    await lookup.open(['affect']);
    const state = lookup.getState()!;
    expect(state.status).toBe('failed');
    expect(state.error).toMatchObject({ key: 'error.explain', values: { what: { key: 'lookup.failed' }, cause: 'resource not found.', next: { key: 'lookup.failedNext' } } });
  });

  it('a newer lookup wins over one still loading, and closing drops a late result', async () => {
    const first = deferred<Dictionary>();
    const dictionary = await dictionaryFile();
    let calls = 0;
    const lookup = lookupWith(() => (++calls === 1 ? first.promise : Promise.resolve(dictionary)));
    const slow = lookup.open(['affect']);
    await lookup.open(['receive']);
    first.resolve(dictionary);
    await slow;
    expect(lookup.getState()?.words).toEqual(['receive']);

    const late = deferred<Dictionary>();
    const closing = lookupWith(() => late.promise);
    const pending = closing.open(['affect']);
    closing.close();
    late.resolve(dictionary);
    await pending;
    expect(closing.getState()).toBeNull();
  });

  it('notifies subscribers on every change', async () => {
    const dictionary = await dictionaryFile();
    const lookup = lookupWith(() => Promise.resolve(dictionary));
    let changes = 0;
    const stop = lookup.subscribe(() => changes++);
    await lookup.open(['affect']);
    lookup.close();
    stop();
    expect(changes).toBe(3); // loading, ready, closed
  });
});
