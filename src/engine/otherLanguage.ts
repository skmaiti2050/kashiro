import type { Candidate, Span } from './types';
import { isRomanisedIndic, loadRomanisedModel } from './romanised/classifier';
import { nearbyWords } from './suggestions/frequency';
import { sentenceSpans } from './sentences';
import { WORD_REWRITE_KINDS } from './wordFlags';

/** A word written all in lowercase a-z: "chalo" (not "Chalo", "chalo's" or "चलो"). */
const LOWERCASE_WORD = /^[a-z]+$/;

/**
 * A card word one edit from an English word at least this common (Zipf 4: ten per million words, "join",
 * "boys", "poor") may be a slip of it, so it starts unticked on the card.
 */
const EVERYDAY_WORD_ZIPF = 4;

/** A word of a sentence, for counting: "school", "don't", "स्कूल" (its vowel signs, virama and joiners inside it). */
const WORD = /\p{L}[\p{L}\p{M}‌‍]*(?:['’]\p{L}[\p{L}\p{M}‌‍]*)*/gu;

/** How many words `text` has, counted the same way for the foreign-sentence rule and for reporting it. */
export function countWords(text: string): number {
  return (text.match(WORD) ?? []).length;
}

/** A Spelling/Typo flag of a lowercase a-z word: the only flags the classifier judges. */
function isLowercaseWordFlag(c: Candidate): boolean {
  return WORD_REWRITE_KINDS.has(c.kind) && LOWERCASE_WORD.test(c.original);
}

/**
 * Loads the classifier's model when `candidates` (all of a check's) hold a lowercase word flag, so
 * isRomanisedIndic works for the rest of the check. A check of plain English never loads it.
 */
export async function loadModelIfNeeded(candidates: Candidate[]): Promise<void> {
  if (candidates.some(isLowercaseWordFlag)) await loadRomanisedModel();
}

/**
 * paraId → the sentences the English checker mostly doesn't know: more than half of their words are flagged
 * Spelling/Typo ("ami kal school te jabo"). They are in another language, so a "slip" there is not one:
 * "te" is Bengali "at", not "the".
 */
export function findForeignSentences(candidates: Candidate[], paraText: ReadonlyMap<number, string>): Map<number, Span[]> {
  return sentencesWhere(candidates, paraText, (flags, sentence) => flags.length * 2 > countWords(sentence));
}

/**
 * paraId → the sentences with a Spelling/Typo flag of a romanised Indian-language word ("dhaba te ate makki di
 * roti"). A two-letter "slip" there is more likely a word of that language (Punjabi "te", "and") than a typo.
 */
export function findRomanisedSentences(candidates: Candidate[], paraText: ReadonlyMap<number, string>): Map<number, Span[]> {
  return sentencesWhere(candidates, paraText, (flags) => flags.some((c) => isLowercaseWordFlag(c) && isRomanisedIndic(c.original)));
}

/** paraId → the sentences whose Spelling/Typo flags (and text) satisfy `keep`. */
function sentencesWhere(
  candidates: Candidate[],
  paraText: ReadonlyMap<number, string>,
  keep: (flags: Candidate[], sentence: string) => boolean,
): Map<number, Span[]> {
  const flagsByPara = new Map<number, Candidate[]>();
  for (const c of candidates) {
    if (!WORD_REWRITE_KINDS.has(c.kind)) continue;
    const flags = flagsByPara.get(c.paraId);
    if (flags) flags.push(c);
    else flagsByPara.set(c.paraId, [c]);
  }
  const found = new Map<number, Span[]>();
  for (const [paraId, flags] of flagsByPara) {
    const text = paraText.get(paraId) ?? '';
    const spans = sentenceSpans(text).filter((s) =>
      keep(
        flags.filter((c) => s.start <= c.span.start && c.span.end <= s.end),
        text.slice(s.start, s.end),
      ),
    );
    if (spans.length) found.set(paraId, spans);
  }
  return found;
}

/**
 * The words among `flags` (review-tier flags) that are romanised Indian-language words (spec §5 words in
 * Indian languages), lowercased. Only a word the document writes in lowercase somewhere counts: a capitalised
 * word alone is more likely a name ("Venkatraman"). Words in `typoWords` (the user said they are typos) and
 * `exclude` (already on the terms card) are left out. `foreignSentences` (findForeignSentences) lets a word
 * common in English ("ki", "mom") count there.
 */
export function findOtherLanguageWords(
  flags: Candidate[],
  typoWords: ReadonlySet<string>,
  exclude: ReadonlySet<string>,
  foreignSentences: ReadonlyMap<number, Span[]> = new Map(),
): Set<string> {
  const words = new Set<string>();
  for (const c of flags) {
    if (!isLowercaseWordFlag(c)) continue;
    if (typoWords.has(c.original) || exclude.has(c.original)) continue;
    const inForeignSentence = (foreignSentences.get(c.paraId) ?? []).some((s) => s.start <= c.span.start && c.span.end <= s.end);
    if (isRomanisedIndic(c.original, inForeignSentence)) words.add(c.original);
  }
  return words;
}

/** The most common everyday English word one edit from `word` ("jion" → "join"), if there is one. */
export function everydayWordNear(word: string): string | undefined {
  // nearbyWords lists the closest first, then the most common.
  return nearbyWords(word, 1).find((near) => near.zipf >= EVERYDAY_WORD_ZIPF)?.word;
}
