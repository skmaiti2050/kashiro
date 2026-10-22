import type { Dictionary, Sense } from '@/engine/dictionary/lookup';

const RECEIVE: Sense[] = [
  { pos: 'verb', definition: 'get something; come into possession of', example: 'receive gifts', synonyms: ['have', 'get'] },
  { pos: 'verb', definition: 'receive a specified treatment', synonyms: ['get', 'find'] },
  { pos: 'verb', definition: 'express willingness to have in one’s home or environs', synonyms: ['invite', 'take in'] },
  { pos: 'verb', definition: 'accept as true or valid', synonyms: [] },
];

const SENSES: Record<string, Sense[]> = {
  receive: RECEIVE,
  farmers: [{ pos: 'noun', definition: 'a person who operates a farm', synonyms: ['husbandman', 'granger'], formOf: 'farmer' }],
  cat: [{ pos: 'noun', definition: 'feline mammal usually having thick soft fur', synonyms: ['true cat'] }],
  'colour-coded': [{ pos: 'adjective', definition: 'having a colour code', synonyms: [] }],
};

/** A dictionary with a few words ("receive" has four senses, to show the panel's cap of three). "lakh" is Indian English. */
export const fakeDictionary: Dictionary = {
  lookup(word, { personal }) {
    const lower = word.toLowerCase();
    return {
      word,
      lemma: lower,
      senses: SENSES[lower] ?? [],
      inPersonalDictionary: personal.has(word),
      inIndianEnglishList: lower === 'lakh',
    };
  },
};

/** A promise and its resolve/reject, to hold the dictionary "loading". */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
