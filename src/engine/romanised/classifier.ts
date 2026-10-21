// Character n-gram models of ten romanised Indian languages and English, from the Dakshina dataset and
// wordfreq (CC BY-SA 4.0; see resources/romanised/ATTRIBUTION.md), loaded by loadRomanisedModel.
import { INDIAN_LANGUAGES, type IndianLanguage, type RomanisedModelData } from './modelData';
import { nearbyWords, wordsByFrequency, zipfOf } from '../suggestions/frequency';
import { withinOneEdit } from '../wordFlags';

/** Only plain lowercase a-z words are judged: never Devanagari or Bengali script, capitals or apostrophes. */
const ROMAN_WORD = /^[a-z]{2,}$/;

/**
 * The word must be at least this likely to be in an Indian language rather than English by the n-gram models,
 * the ten languages sharing the Indian side equally (chosen with SLIP_ODDS_OFFSET on the tune split, spec §5).
 * Below 0.6, as for two languages in S7, because each language now holds a tenth of the Indian side: with the
 * rules below, 70-95% of each language's flagged words (tokens) and 3.0% of English typos pass.
 */
const MIN_INDIC_PROBABILITY = 0.3;

/**
 * The word must also read like a word of its likeliest Indian language: its natural-log probability per
 * character (the end mark included) must be at least this, a little better than random letters (ln 1/28 =
 * -3.33). Junk ("wrdqqqqqx") is unlikely under every model, so the ratio against English alone says nothing.
 */
const MIN_LOG_PROBABILITY_PER_CHAR = -3.2;

/**
 * A two-letter word this common in English text (Zipf 3.9: "ra", "po", "da", "ok") is English unless its
 * sentence is mostly in another language: two letters are too few to tell the languages apart, and Hindi
 * "ki" is exactly as common in English text as "ra". "ke" (3.5) is judged like any word.
 */
const TWO_LETTER_ENGLISH_ZIPF = 3.9;

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
 * log10 P(word | Indian) + this offset beats log10 of the summed frequency (per billion words) of the common
 * words one edit away. The offset folds in the per-billion scale (9) and how likely an Indian-language word is
 * against a one-letter slip (about 600 : 1, tuned on the tune split): "tini" (Bengali "he") beats "tiny",
 * "teh" never beats "the".
 */
const SLIP_ODDS_OFFSET = 9 + 2.8;

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

let models: { english: CharModel; indian: [IndianLanguage, CharModel][] } | undefined;

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
  const { order, english, indian } = data as RomanisedModelData;
  models ??= {
    english: loadModel(english, order),
    indian: INDIAN_LANGUAGES.map((language) => [language, loadModel(indian[language], order)]),
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
/** word → its log-likelihood under each Indian language, in INDIAN_LANGUAGES order. */
const languageScores = new Map<string, number[]>();

/** True when `word` is one edit from one of the commonest English words ("hai" → "had"). */
function isSlipOfTopWord(word: string): boolean {
  alwaysSlipWords ??= wordsByFrequency()
    .slice(0, ALWAYS_SLIP_TOP)
    .filter((w) => ALWAYS_SLIP_WORD.test(w));
  return alwaysSlipWords.some((w) => Math.abs(w.length - word.length) <= 1 && withinOneEdit(w, word));
}

/**
 * The log-likelihood of `word` under each Indian language's model, in INDIAN_LANGUAGES order (memoised).
 * Throws when loadRomanisedModel has not finished.
 */
export function indianLanguageScores(word: string): number[] {
  let scores = languageScores.get(word);
  if (!scores) {
    scores = getModels().indian.map(([, model]) => logLikelihood(model, word));
    languageScores.set(word, scores);
  }
  return scores;
}

function judge(word: string): boolean {
  if (!ROMAN_WORD.test(word) || isSlipOfTopWord(word)) return false;
  // The Indian languages count as one class against English (one card), each an equal share of it.
  const scores = indianLanguageScores(word);
  if (Math.max(...scores) / (word.length + 1) < MIN_LOG_PROBABILITY_PER_CHAR) return false;
  const indic = scores.reduce(logSum, -Infinity) - Math.log(scores.length);
  const notIndic = logLikelihood(getModels().english, word);
  if (1 / (1 + Math.exp(notIndic - indic)) < MIN_INDIC_PROBABILITY) return false;
  const slipMass = nearbyWords(word, 1).reduce((sum, near) => sum + 10 ** near.zipf, 0);
  return slipMass === 0 || indic / Math.LN10 + SLIP_ODDS_OFFSET > Math.log10(slipMass);
}

/**
 * True when a word the English spell checker flagged is a romanised Indian-language word ("accha", "khub",
 * "konjam") rather than a typo (spec §5 words in Indian languages). Only lowercase a-z words qualify; a slip of
 * a very common English word never does, and a slip of a rarer one only when the word is the likelier reading.
 * A two-letter word common in English ("ra", "ki") qualifies only when `inForeignSentence` (it sits in a
 * sentence mostly in another language: findForeignSentences). Throws when a word needs the model and
 * loadRomanisedModel has not finished.
 */
export function isRomanisedIndic(word: string, inForeignSentence = false): boolean {
  if (!inForeignSentence && word.length === 2 && zipfOf(word) >= TWO_LETTER_ENGLISH_ZIPF) return false;
  let verdict = verdicts.get(word);
  if (verdict === undefined) {
    verdict = judge(word);
    verdicts.set(word, verdict);
  }
  return verdict;
}
