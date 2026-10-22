/**
 * The data snapshot (Task S8): hashes of the built resource files, dictionary counts plus 50 fixed lookups,
 * and word-list counts plus a hash of each sorted list. Written to deps/snapshots/data.json.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { loadDictionary } from '../../src/engine/dictionary/lookup';
import type { DictionaryData } from '../../src/engine/dictionary/types';
import { EN_IN_WORDS } from '../../src/engine/wordlists/en-IN';
import { TECH_WORDS } from '../../src/engine/wordlists/tech';
import { COMMON_WORDS } from '../../src/engine/wordlists/common';
import { wordsByFrequency } from '../../src/engine/suggestions/frequency';
import { INDIAN_LANGUAGES, type RomanisedModelData } from '../../src/engine/romanised/modelData';
import { compareText } from './licences';

const DICTIONARY = 'resources/dictionary/oewn.json.gz';
const FREQUENCY = 'resources/frequency/en-wordfreq.json';
const ROMANISED = 'resources/romanised/romanised-ngrams.json';
/** Long enough to tell a changed definition, short enough to stay an excerpt. */
const DEFINITION_EXCERPT = 60;

/**
 * Fixed lookups: everyday words, irregular and regular inflections, words with no own entry, an
 * Indian-English word, a tech word, an unknown word and an Object.prototype name.
 */
export const LOOKUP_WORDS = [
  'the', 'good', 'run', 'bank', 'light', 'set', 'well', 'fast', 'book', 'play',
  'went', 'geese', 'saw', 'left', 'better', 'mice', 'children', 'was', 'ran', 'studies',
  'studied', 'happier', 'happiest', 'boxes', 'cats', 'walked', 'walking', 'taller', 'making', 'running',
  'news', 'its', 'is', 'receive', 'separate', 'accommodate', 'necessary', 'monsoon', 'chai', 'sarpanch',
  'lakh', 'crore', 'api', 'download', 'email', 'heatwave', 'serendipity', 'xyzzyq', 'constructor', 'toString',
] as const;

export interface DataSnapshot {
  files: Record<string, string>;
  dictionary: { lemmas: number; exceptions: number; senses: number; lookups: Record<string, string> };
  wordlists: Record<string, { count: number; sha256: string }>;
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Count and hash of a word list, sorted so that order changes alone don't count. */
function listSummary(words: Iterable<string>): { count: number; sha256: string } {
  const sorted = [...words].sort(compareText);
  return { count: sorted.length, sha256: sha256(sorted.join('\n')) };
}

/** Summary of one model row ("^^^a 12 ^^ab 3 ..."): its n-grams and their counts. */
function ngramSummary(row: string): { count: number; sha256: string } {
  return { count: row ? row.split(' ').length / 2 : 0, sha256: sha256(row) };
}

/** `root` is the repository root. */
export async function buildDataSnapshot(root: string): Promise<DataSnapshot> {
  const read = (file: string) => fs.readFileSync(path.join(root, file));
  const files: Record<string, string> = {};
  for (const file of [DICTIONARY, FREQUENCY, ROMANISED]) files[file] = sha256(read(file));

  const dictionaryBytes = new Uint8Array(read(DICTIONARY));
  const dictionary = await loadDictionary(dictionaryBytes);
  const data = JSON.parse(gunzipSync(dictionaryBytes).toString('utf8')) as DictionaryData;
  const lookups: Record<string, string> = {};
  for (const word of LOOKUP_WORDS) {
    const result = dictionary.lookup(word, { personal: new Set() });
    const first = result.senses[0];
    const sense = first ? `${first.pos}: ${first.definition.slice(0, DEFINITION_EXCERPT)}` : 'no senses';
    const lists = result.inIndianEnglishList ? '; Indian-English list' : '';
    lookups[word] = `${result.lemma}; ${result.senses.length} senses; ${sense}${lists}`;
  }

  const model = JSON.parse(read(ROMANISED).toString('utf8')) as RomanisedModelData;
  const wordlists: DataSnapshot['wordlists'] = {
    'en-IN': listSummary(EN_IN_WORDS),
    tech: listSummary(TECH_WORDS),
    common: listSummary(COMMON_WORDS),
    frequency: listSummary(wordsByFrequency()),
  };
  model.english.forEach((row, i) => (wordlists[`romanised english order ${i + 1}`] = ngramSummary(row)));
  for (const language of INDIAN_LANGUAGES) {
    model.indian[language].forEach((row, i) => (wordlists[`romanised ${language} order ${i + 1}`] = ngramSummary(row)));
  }

  const senses = Object.values(data.entries).reduce((n, rows) => n + rows.length, 0);
  return {
    files,
    dictionary: { lemmas: Object.keys(data.entries).length, exceptions: Object.keys(data.exceptions).length, senses, lookups },
    wordlists,
  };
}
