// English word frequencies from wordfreq 3.1.1 (CC BY-SA 4.0; see resources/frequency/ATTRIBUTION.md).
// A JSON import, so the engine has it synchronously in Node and in the browser bundle (~0.4 MB gzipped).
import data from '../../../resources/frequency/en-wordfreq.json';
import type { FrequencyData } from './frequencyData';
import { editDistance } from '../wordFlags';

/**
 * Words rarer than this are never added as suggestions. Zipf 3.0 is about once per million words:
 * "existent" (3.5) can be added, "lithe" (2.5) can't.
 */
const SUGGESTION_POOL_ZIPF = 3.0;

export interface NearbyWord {
  word: string;
  zipf: number;
  distance: number;
}

interface Index {
  zipfByWord: Map<string, number>;
  /** All words, most frequent first. */
  ordered: string[];
  /** Common a-z words by length, for nearbyWords. */
  commonByLength: Map<number, { word: string; zipf: number; letters: number }[]>;
}

let index: Index | undefined;

/**
 * Builds the lookup tables on first use (25-40 ms on the development machine). In practice that is when
 * the engine loads: wordlists/common.ts reads the list at import.
 */
function getIndex(): Index {
  if (index) return index;
  const zipfByWord = new Map<string, number>();
  const ordered: string[] = [];
  const commonByLength: Index['commonByLength'] = new Map();
  for (const [zipf, text] of (data as FrequencyData).buckets) {
    for (const word of text.split(' ')) {
      zipfByWord.set(word, zipf);
      ordered.push(word);
      if (zipf < SUGGESTION_POOL_ZIPF || word.includes("'")) continue;
      const sameLength = commonByLength.get(word.length) ?? [];
      sameLength.push({ word, zipf, letters: letterSet(word) });
      commonByLength.set(word.length, sameLength);
    }
  }
  index = { zipfByWord, ordered, commonByLength };
  return index;
}

/** Zipf frequency of a word (case-insensitive; curly apostrophes read as straight), 0 when it is not in the list. */
export function zipfOf(word: string): number {
  return getIndex().zipfByWord.get(word.toLowerCase().replace(/’/g, "'")) ?? 0;
}

/** Every word in the list, most frequent first. */
export function wordsByFrequency(): readonly string[] {
  return getIndex().ordered;
}

/**
 * Common words (Zipf ≥ 3.0, letters only) at most `maxEdits` edits from `word` (editDistance), nearest
 * first, then most frequent. `word` itself is not listed.
 */
export function nearbyWords(word: string, maxEdits: number): NearbyWord[] {
  const lower = word.toLowerCase();
  const letters = letterSet(lower);
  const found: NearbyWord[] = [];
  for (let length = lower.length - maxEdits; length <= lower.length + maxEdits; length++) {
    for (const entry of getIndex().commonByLength.get(length) ?? []) {
      // Each edit adds or removes at most two letters from the set, so this skips most words cheaply.
      if (bitCount(letters ^ entry.letters) > 2 * maxEdits || entry.word === lower) continue;
      const distance = editDistance(lower, entry.word, maxEdits);
      if (distance <= maxEdits) found.push({ word: entry.word, zipf: entry.zipf, distance });
    }
  }
  return found.sort((a, b) => a.distance - b.distance || b.zipf - a.zipf);
}

/** The letters a-z in `word` as bits (other characters get bit 26). */
function letterSet(word: string): number {
  let bits = 0;
  for (let i = 0; i < word.length; i++) {
    const code = word.charCodeAt(i) - 97;
    bits |= 1 << (code >= 0 && code < 26 ? code : 26);
  }
  return bits;
}

function bitCount(n: number): number {
  let count = 0;
  for (; n; n &= n - 1) count++;
  return count;
}
