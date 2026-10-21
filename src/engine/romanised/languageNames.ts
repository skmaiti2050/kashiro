import { INDIAN_LANGUAGES, type IndianLanguage } from './modelData';
import { indianLanguageScores } from './classifier';

/**
 * Rounds of re-estimating the document's language mix (EM). One word alone is a poor guide ("kya" scores
 * Kannada by a hair), the document's other words are a good one: on the tune split, sentence by sentence,
 * five rounds name 82-95% of the words right per language, against 36-81% word by word.
 */
const CONTEXT_ROUNDS = 5;
/** Pseudo-count per language when estimating the mix, so no language is ruled out entirely. */
const MIX_SMOOTHING = 0.1;
/**
 * Hindi and Urdu share most of their romanised words: a word is named after one of the two only when it is
 * at least this much likelier (natural log, 10 : 1) under that one, otherwise "Hindi/Urdu".
 */
const HINDI_URDU_MIN_LEAD = Math.log(10);

/** "tamil" → "Tamil". */
const displayName = (language: IndianLanguage) => language[0].toUpperCase() + language.slice(1);

/** Per language, the share of `words` it explains given the mix `prior` (log), smoothed. */
function nextMix(words: string[], logPrior: number[]): number[] {
  const totals = INDIAN_LANGUAGES.map(() => MIX_SMOOTHING);
  for (const word of words) {
    const joint = indianLanguageScores(word).map((score, i) => score + logPrior[i]);
    const top = Math.max(...joint);
    const weights = joint.map((v) => Math.exp(v - top));
    const sum = weights.reduce((a, b) => a + b, 0);
    weights.forEach((w, i) => (totals[i] += w / sum));
  }
  const all = totals.reduce((a, b) => a + b, 0);
  return totals.map((t) => Math.log(t / all));
}

/**
 * Names the language of each of `words` (romanised Indian-language words of one document): "konjam" → "Tamil",
 * "accha" → "Hindi/Urdu". Each word's own scores are weighed against the document's language mix, estimated
 * from all of `words`, so "kya" in a Hindi text is Hindi.
 */
export function nameLanguages(words: string[]): Map<string, string> {
  let logPrior = INDIAN_LANGUAGES.map(() => -Math.log(INDIAN_LANGUAGES.length));
  for (let round = 0; round < CONTEXT_ROUNDS; round++) logPrior = nextMix(words, logPrior);
  const hindi = INDIAN_LANGUAGES.indexOf('hindi');
  const urdu = INDIAN_LANGUAGES.indexOf('urdu');
  const names = new Map<string, string>();
  for (const word of words) {
    const joint = indianLanguageScores(word).map((score, i) => score + logPrior[i]);
    const best = joint.indexOf(Math.max(...joint));
    const hindiOrUrdu = best === hindi || best === urdu;
    const unclear = hindiOrUrdu && Math.abs(joint[hindi] - joint[urdu]) < HINDI_URDU_MIN_LEAD;
    names.set(word, unclear ? 'Hindi/Urdu' : displayName(INDIAN_LANGUAGES[best]));
  }
  return names;
}
