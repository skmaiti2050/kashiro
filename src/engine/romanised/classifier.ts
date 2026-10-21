// Character n-gram models of romanised Hindi, romanised Bengali and English, from the Dakshina dataset and
// wordfreq (CC BY-SA 4.0; see resources/romanised/ATTRIBUTION.md), loaded by loadRomanisedModel.
import type { RomanisedModelData } from './modelData';
import { nearbyWords, wordsByFrequency } from '../suggestions/frequency';
import { withinOneEdit } from '../wordFlags';

/** Only plain lowercase a-z words are judged: never Devanagari or Bengali script, capitals or apostrophes. */
const ROMAN_WORD = /^[a-z]{2,}$/;

/**
 * The word must be at least this likely to be Hindi/Bengali rather than English by the n-gram models
 * (chosen on the tune split, spec §5: at 0.6, 85% of flagged Hindi/Bengali words and 2.5% of English typos
 * pass; "accha" scores 0.68).
 */
const MIN_INDIC_PROBABILITY = 0.6;

/**
 * A slip of one of the commonest English words always wins (spec §5 "a slip wins"): "hai" stays a flag
 * because "had" is one edit away. This many of the most frequent words count.
 */
const ALWAYS_SLIP_TOP = 500;
/**
 * Words of three letters or more. Two-letter ones ("he", "no") would block every two-letter Hindi word
 * ("ke", "na"), the commonest flags in Hindi text; for those the slip is weighed below instead.
 */
const ALWAYS_SLIP_WORD = /^[a-z]{3,}$/;

/**
 * For rarer neighbours the slip and the word are weighed (noisy channel): the word joins the card only when
 * log10 P(word | Hindi/Bengali) + this offset beats log10 of the summed frequency (per billion words) of
 * the common words one edit away. The offset folds in the per-billion scale (9) and how likely a Hindi/Bengali
 * word is against a one-letter slip (about 200 : 1, tuned on the tune split): "tini" (Bengali "he") beats
 * "tiny", "teh" never beats "the".
 */
const SLIP_ODDS_OFFSET = 9 + 2.3;

/** Characters in the models: a-z, the start pad "^" and the end mark "$". */
const ALPHABET_SIZE = 28;

/**
 * One language's counts in flat arrays indexed by the n-gram read as a base-28 number (a Map of strings took
 * about 180 ms to build; these take a few). Index n holds the tables of order n.
 */
interface CharModel {
  order: number;
  counts: Uint32Array[];
  /** Per context (an n-gram minus its last character): total count, and the distinct characters seen after it. */
  contextTotals: Uint32Array[];
  contextDistinct: Uint32Array[];
}

let models: { hindi: CharModel; bengali: CharModel; english: CharModel } | undefined;

function charCode(ch: string): number {
  if (ch === '^') return 26;
  if (ch === '$') return 27;
  return ch.charCodeAt(0) - 97;
}

/** The base-28 index of `text.slice(start, end)`. */
function indexOf(text: string, start: number, end: number): number {
  let index = 0;
  for (let i = start; i < end; i++) index = index * ALPHABET_SIZE + charCode(text[i]);
  return index;
}

function loadModel(tables: string[], order: number): CharModel {
  const model: CharModel = { order, counts: [], contextTotals: [], contextDistinct: [] };
  for (let n = 1; n <= order; n++) {
    const counts = new Uint32Array(ALPHABET_SIZE ** n);
    const totals = new Uint32Array(ALPHABET_SIZE ** (n - 1));
    const distinct = new Uint32Array(ALPHABET_SIZE ** (n - 1));
    const parts = tables[n - 1].split(' ');
    for (let j = 0; j < parts.length; j += 2) {
      const gram = indexOf(parts[j], 0, n);
      const count = Number(parts[j + 1]);
      const context = Math.floor(gram / ALPHABET_SIZE);
      counts[gram] = count;
      totals[context] += count;
      distinct[context]++;
    }
    model.counts[n] = counts;
    model.contextTotals[n] = totals;
    model.contextDistinct[n] = distinct;
  }
  return model;
}

/**
 * Loads and parses the models. The check calls it only when a document has a lowercase unknown word, and the
 * dynamic import keeps the JSON (about 430 KB gzipped) out of the app's main bundle. Later calls do nothing.
 */
export async function loadRomanisedModel(): Promise<void> {
  if (models) return;
  const { default: data } = await import('../../../resources/romanised/romanised-ngrams.json');
  const { order, languages } = data as RomanisedModelData;
  models ??= {
    hindi: loadModel(languages.hindi, order),
    bengali: loadModel(languages.bengali, order),
    english: loadModel(languages.english, order),
  };
}

function getModels(): NonNullable<typeof models> {
  if (!models) throw new Error('The romanised model is not loaded: await loadRomanisedModel() before isRomanisedIndic.');
  return models;
}

/** Natural log of P(word) under `model`: Witten-Bell interpolation from unigrams up to the full order. */
function logLikelihood(model: CharModel, word: string): number {
  const padded = '^'.repeat(model.order - 1) + word + '$';
  let total = 0;
  for (let end = model.order; end <= padded.length; end++) {
    let probability = 1 / ALPHABET_SIZE;
    for (let n = 1; n <= model.order; n++) {
      const gram = indexOf(padded, end - n, end);
      const context = Math.floor(gram / ALPHABET_SIZE);
      const total = model.contextTotals[n][context];
      if (total === 0) break; // an unseen context has no longer one either
      const distinct = model.contextDistinct[n][context];
      probability = (model.counts[n][gram] + distinct * probability) / (total + distinct);
    }
    total += Math.log(probability);
  }
  return total;
}

/** log(e^a + e^b) without overflow. */
function logSum(a: number, b: number): number {
  return Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)));
}

let alwaysSlipWords: string[] | undefined;
const verdicts = new Map<string, boolean>();

/** True when `word` is one edit from one of the commonest English words ("hai" → "had"). */
function isSlipOfTopWord(word: string): boolean {
  alwaysSlipWords ??= wordsByFrequency()
    .slice(0, ALWAYS_SLIP_TOP)
    .filter((w) => ALWAYS_SLIP_WORD.test(w));
  return alwaysSlipWords.some((w) => Math.abs(w.length - word.length) <= 1 && withinOneEdit(w, word));
}

function judge(word: string): boolean {
  if (!ROMAN_WORD.test(word) || isSlipOfTopWord(word)) return false;
  const { hindi, bengali, english } = getModels();
  // Hindi and Bengali count as one language (one card), each half of it.
  const indic = logSum(logLikelihood(hindi, word), logLikelihood(bengali, word)) - Math.LN2;
  const notIndic = logLikelihood(english, word);
  if (1 / (1 + Math.exp(notIndic - indic)) < MIN_INDIC_PROBABILITY) return false;
  const slipMass = nearbyWords(word, 1).reduce((sum, near) => sum + 10 ** near.zipf, 0);
  return slipMass === 0 || indic / Math.LN10 + SLIP_ODDS_OFFSET > Math.log10(slipMass);
}

/**
 * True when a word the English spell checker flagged is romanised Hindi or Bengali ("accha", "chalo",
 * "khub") rather than a typo (spec §5 words in other languages). Only lowercase a-z words qualify; a slip of
 * a very common English word never does, and a slip of a rarer one only when the word is the likelier reading.
 * Throws when a word needs the model and loadRomanisedModel has not finished.
 */
export function isRomanisedIndic(word: string): boolean {
  let verdict = verdicts.get(word);
  if (verdict === undefined) {
    verdict = judge(word);
    verdicts.set(word, verdict);
  }
  return verdict;
}
