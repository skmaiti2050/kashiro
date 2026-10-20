import { EN_IN_WORDS } from '../wordlists/en-IN';

export interface Sense {
  pos: 'noun' | 'verb' | 'adjective' | 'adverb';
  definition: string;
  example?: string;
  synonyms: string[];
}

export interface LookupResult {
  /** The word as the caller typed it. */
  word: string;
  /** The dictionary headword the senses belong to; the lowercase word when nothing was found. */
  lemma: string;
  senses: Sense[];
  inPersonalDictionary: boolean;
  inIndianEnglishList: boolean;
}

export interface Dictionary {
  lookup(word: string, opts: { personal: Set<string> }): LookupResult;
}

type PosCode = 'n' | 'v' | 'a' | 'r';
// Same shape the build script writes (scripts/build-dictionary.ts).
type SenseRow = [PosCode, string, string, string[]];
interface DictionaryData {
  entries: Record<string, SenseRow[]>;
  exceptions: Record<string, string>;
}

const POS_NAMES: Record<PosCode, Sense['pos']> = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' };
const MIN_STEM_LENGTH = 3; // keeps "its" from becoming "it" and "is" from becoming "i"
const INDIAN_ENGLISH_WORDS = new Set(EN_IN_WORDS);

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

  /** Headword for a lowercase word: WordNet's exception forms first, then the word itself, then suffix rules. */
  function findLemma(word: string): string | undefined {
    // Exceptions win over the word itself so "better" reads as "good" (spec §3 item 9).
    const exception = exceptionFor(word);
    if (exception) return exception;
    if (entryFor(word)) return word;
    return stemCandidates(word).find((candidate) => entryFor(candidate));
  }

  return {
    lookup(word, { personal }) {
      const lower = word.toLowerCase();
      const lemma = findLemma(lower);
      const rows = lemma ? (entryFor(lemma) ?? []) : [];
      return {
        word,
        lemma: lemma ?? lower,
        senses: rows.map(toSense),
        inPersonalDictionary: personal.has(lower) || personal.has(word),
        inIndianEnglishList: INDIAN_ENGLISH_WORDS.has(lower),
      };
    },
  };
}

function toSense([pos, definition, example, synonyms]: SenseRow): Sense {
  const sense: Sense = { pos: POS_NAMES[pos], definition, synonyms };
  if (example) sense.example = example;
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
