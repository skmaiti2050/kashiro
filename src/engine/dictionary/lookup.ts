import { EN_IN_WORDS } from '../wordlists/en-IN';
import type { DictionaryData, PosCode, SenseRow } from './types';

export interface Sense {
  pos: 'noun' | 'verb' | 'adjective' | 'adverb';
  definition: string;
  example?: string;
  synonyms: string[];
  /** Set on senses of the base form when the word is an inflection of it ("saw": senses of "see" carry formOf: "see"). */
  formOf?: string;
}

export interface LookupResult {
  /** The word as the caller typed it. */
  word: string;
  /** The base form when the word is an inflection of one ("saw" -> "see"), else the lowercase word. */
  lemma: string;
  /** The word's own senses first, then the base form's senses marked with formOf. */
  senses: Sense[];
  inPersonalDictionary: boolean;
  inIndianEnglishList: boolean;
}

export interface Dictionary {
  lookup(word: string, opts: { personal: Set<string> }): LookupResult;
}

const POS_NAMES: Record<PosCode, Sense['pos']> = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' };
const MIN_STEM_LENGTH = 3; // keeps "its" from becoming "it" and "is" from becoming "i"
const INDIAN_ENGLISH_WORDS = new Set(EN_IN_WORDS);
/** A word of an example sentence: "won", "Chattanooga", "don't". */
const EXAMPLE_WORD = /[\p{L}'’-]+/gu;

// slice() copies into a plain ArrayBuffer, which is what Blob accepts under strict typings.
async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Reads the build output once; lookups afterwards are plain property reads. */
export async function loadDictionary(bytes: Uint8Array): Promise<Dictionary> {
  const data = JSON.parse(await gunzip(bytes)) as DictionaryData;
  // Own-property checks: a typed word such as "constructor" must not reach Object.prototype.
  const entryFor = (lemma: string): SenseRow[] | undefined =>
    Object.hasOwn(data.entries, lemma) ? data.entries[lemma] : undefined;
  const exceptionFor = (form: string): string | undefined =>
    Object.hasOwn(data.exceptions, form) ? data.exceptions[form] : undefined;

  /** Base form of a lowercase word: WordNet's exception forms first, then suffix rules (spec §3 item 9). */
  function findBaseForm(word: string): string | undefined {
    const exception = exceptionFor(word);
    if (exception) return exception;
    // Suffix rules only for words with no entry of their own: "news" is not a plural of "new".
    if (entryFor(word)) return undefined;
    return stemCandidates(word).find((candidate) => entryFor(candidate));
  }

  /** True when a word of `example` is `headword` or an inflection of it ("ran" for run, "engagements"). */
  function usesWord(example: string, headword: string): boolean {
    const parts = headword.split(/[\s_]+/);
    const tokens = example.toLowerCase().match(EXAMPLE_WORD) ?? [];
    const formsOf = (token: string) => [token, exceptionFor(token), ...stemCandidates(token)];
    return parts.every((part) => tokens.some((token) => formsOf(token).includes(part)));
  }

  /**
   * WordNet gives each sense its synset's examples, which may use another word of the synset ("engagement":
   * "Grant won a decisive victory in the battle of Chattanooga"). An example that doesn't use the word is dropped.
   */
  const senseOf = (row: SenseRow, headword: string, formOf?: string): Sense => {
    const sense = toSense(row, formOf);
    if (sense.example && !usesWord(sense.example, headword)) delete sense.example;
    return sense;
  };

  return {
    lookup(word, { personal }) {
      const lower = word.toLowerCase();
      // The word's own senses come first so "saw" and "left" still show the tool and the direction.
      const baseForm = findBaseForm(lower);
      const ownSenses = (entryFor(lower) ?? []).map((row) => senseOf(row, lower));
      const baseSenses = baseForm ? (entryFor(baseForm) ?? []).map((row) => senseOf(row, baseForm, baseForm)) : [];
      return {
        word,
        lemma: baseForm ?? lower,
        senses: [...ownSenses, ...baseSenses],
        inPersonalDictionary: personal.has(lower) || personal.has(word),
        inIndianEnglishList: INDIAN_ENGLISH_WORDS.has(lower),
      };
    },
  };
}

function toSense([pos, definition, example, synonyms]: SenseRow, formOf?: string): Sense {
  const sense: Sense = { pos: POS_NAMES[pos], definition, synonyms };
  if (example) sense.example = example;
  if (formOf) sense.formOf = formOf;
  return sense;
}

const SUFFIX_RULES: readonly { suffix: string; replacement: string }[] = [
  { suffix: 'ies', replacement: 'y' }, // studies -> study
  { suffix: 'ied', replacement: 'y' }, // studied -> study
  { suffix: 'ier', replacement: 'y' }, // happier -> happy
  { suffix: 'iest', replacement: 'y' }, // happiest -> happy
  { suffix: 'es', replacement: '' }, // boxes -> box
  { suffix: 's', replacement: '' }, // cats -> cat
  { suffix: 'ed', replacement: '' }, // walked -> walk
  { suffix: 'ing', replacement: '' }, // walking -> walk
  { suffix: 'er', replacement: '' }, // taller -> tall
  { suffix: 'est', replacement: '' }, // tallest -> tall
];

/** Likely headwords for a regular inflection, most likely first. */
function stemCandidates(word: string): string[] {
  const candidates: string[] = [];
  for (const { suffix, replacement } of SUFFIX_RULES) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    if (stem.length < MIN_STEM_LENGTH) continue;
    candidates.push(stem + replacement);
    if (replacement) continue;
    candidates.push(`${stem}e`); // making -> make, nicer -> nice
    if (stem.at(-1) === stem.at(-2)) candidates.push(stem.slice(0, -1)); // running -> run
  }
  return candidates;
}
