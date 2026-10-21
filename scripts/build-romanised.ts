/**
 * Builds resources/romanised/romanised-ngrams.json: character n-gram counts for ten romanised Indian languages
 * (INDIAN_LANGUAGES) and English, used to tell a flagged Indian-language word ("accha", "khub", "konjam") from
 * an English typo and to name its language (spec §5 words in Indian languages).
 *
 * Source: the Dakshina dataset's romanised sentences (Roark, Wolf-Sonkin, Kirov et al., Google Research), as
 *         mirrored on Hugging Face: one CSV with columns lang_code,indic,roman
 * URL:    https://huggingface.co/datasets/suhani-sarvam/google-dakshina (original:
 *         https://github.com/google-research-datasets/dakshina)
 * sha256: 8886730d2c020f8e7cceb784ede2b22e1472c4cacaa0ae79af514ff7cf7c5cf3 (google-dakshina.csv, 38,926,707 bytes)
 * Licence: CC BY-SA 4.0 (see resources/romanised/ATTRIBUTION.md)
 *
 * Only the train split of the sentences is used (splitOf); the tune and test splits are kept for choosing the
 * thresholds and for the acceptance gate (scripts/measure-other-language.ts). Of the romanised words, only
 * those the English spell checker flags are counted: the others are English loanwords ("park", "railway").
 * The English side is the word frequency list (resources/frequency), minus those Indian-language words.
 *
 * Usage: npm run build:romanised -- <google-dakshina.csv>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLinter } from '../src/engine/linter';
import { wordsByFrequency } from '../src/engine/suggestions/frequency';
import { INDIAN_LANGUAGES, type IndianLanguage, type RomanisedModelData } from '../src/engine/romanised/modelData';

export const PINNED_SHA256 = '8886730d2c020f8e7cceb784ede2b22e1472c4cacaa0ae79af514ff7cf7c5cf3';
/** Longest n-gram: 4 separates the languages clearly better than 3 and still fits the 4 MB budget. */
export const ORDER = 4;
/** Dataset language codes of the languages on the card (Sindhi "sd" and Sinhala "si" are left out). */
export const LANGUAGE_CODES: Record<IndianLanguage, string> = {
  hindi: 'hi',
  bengali: 'bn',
  tamil: 'ta',
  telugu: 'te',
  kannada: 'kn',
  malayalam: 'ml',
  marathi: 'mr',
  gujarati: 'gu',
  punjabi: 'pa',
  urdu: 'ur',
};

/** One lowercase a-z word of a romanised sentence: "accha" in "Accha, chalo!". */
const ROMAN_WORD = /[a-z]+/g;
/** A frequency-list word made of a-z only ("garden", not "don't"). */
const AZ_WORD = /^[a-z]+$/;
/** Words linted together per call when asking the spell checker which words it flags. */
const LINT_CHUNK = 300;

export interface DatasetRow {
  language: string;
  roman: string;
}

/** The rows of the CSV (quoted fields may hold commas, quotes and line breaks), header dropped. */
export function parseDataset(csv: string): DatasetRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (csv[i + 1] === '"') field += csv[++i];
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field]);
  const [header, ...data] = rows;
  if (header?.join(',') !== 'lang_code,indic,roman') throw new Error(`Unexpected CSV header: ${header?.join(',')}`);
  return data.map(([language, , roman]) => ({ language, roman }));
}

export type Split = 'train' | 'tune' | 'test';

/**
 * A fixed split by FNV-1a hash of the romanised sentence: 10% test (the acceptance gate), 10% tune (the
 * thresholds), 80% train. The same sentence always lands in the same split.
 */
export function splitOf(sentence: string): Split {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sentence.length; i++) {
    hash ^= sentence.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const bucket = hash % 10;
  return bucket === 0 ? 'test' : bucket === 1 ? 'tune' : 'train';
}

/** The lowercase a-z words of a romanised sentence. */
export function romanWords(sentence: string): string[] {
  return sentence.toLowerCase().match(ROMAN_WORD) ?? [];
}

/** N-gram counts of orders 1..ORDER over `words` (each counted once), as the model's strings. */
export function countNgrams(words: Iterable<string>): string[] {
  const counts = Array.from({ length: ORDER }, () => new Map<string, number>());
  for (const word of words) {
    const padded = '^'.repeat(ORDER - 1) + word + '$';
    for (let end = ORDER; end <= padded.length; end++) {
      for (let n = 1; n <= ORDER; n++) {
        const gram = padded.slice(end - n, end);
        counts[n - 1].set(gram, (counts[n - 1].get(gram) ?? 0) + 1);
      }
    }
  }
  return counts.map((byGram) =>
    [...byGram]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([gram, count]) => `${gram} ${count}`)
      .join(' '),
  );
}

/** The words among `words` that the English spell checker (as the app configures it) flags. */
async function flaggedByEnglishChecker(words: string[]): Promise<Set<string>> {
  const linter = await createLinter('American');
  const flagged = new Set<string>();
  for (let i = 0; i < words.length; i += LINT_CHUNK) {
    // "and" between the words keeps each one a separate, ordinary-looking token.
    const text = words.slice(i, i + LINT_CHUNK).join(' and ') + '.';
    for (const c of await linter.lintSpelling([{ id: 0, text }], 'American')) {
      if (c.kind === 'Spelling' || c.kind === 'Typo') flagged.add(c.original.toLowerCase());
    }
  }
  return flagged;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Usage: npm run build:romanised -- <google-dakshina.csv>');
  const source = readFileSync(inputPath);
  const actual = createHash('sha256').update(source).digest('hex');
  if (actual !== PINNED_SHA256) {
    throw new Error(`Wrong source file: sha256 is ${actual}, expected ${PINNED_SHA256} (Dakshina mirror google-dakshina.csv).`);
  }
  const rows = parseDataset(source.toString('utf8'));
  const trainWords = (code: string) =>
    [...new Set(rows.filter((r) => r.language === code && splitOf(r.roman) === 'train').flatMap((r) => romanWords(r.roman)))].sort();
  const wordsOf = new Map(INDIAN_LANGUAGES.map((language) => [language, trainWords(LANGUAGE_CODES[language])]));
  const flagged = await flaggedByEnglishChecker([...new Set([...wordsOf.values()].flat())].sort());
  for (const [language, words] of wordsOf) wordsOf.set(language, words.filter((w) => flagged.has(w)));
  // The frequency list holds romanised words from the web too ("kiya", "hain"): they are not English here.
  const indian = new Set([...wordsOf.values()].flat());
  const english = wordsByFrequency().filter((w) => AZ_WORD.test(w) && !indian.has(w));

  const data: RomanisedModelData = {
    format: 2,
    order: ORDER,
    english: countNgrams(english),
    indian: Object.fromEntries(INDIAN_LANGUAGES.map((l) => [l, countNgrams(wordsOf.get(l)!)])) as RomanisedModelData['indian'],
  };
  const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), '../resources/romanised/romanised-ngrams.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  const output = JSON.stringify(data);
  writeFileSync(outputPath, output);
  const counts = INDIAN_LANGUAGES.map((l) => `${l} ${wordsOf.get(l)!.length}`).join(', ');
  console.log(`${counts}, english ${english.length} words; ${output.length} bytes -> ${outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
