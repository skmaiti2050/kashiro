import type { Candidate, Span } from './types';
import { isSentenceStart, OPENERS } from './factLock';

export const UPPER_START = /^\p{Lu}/u;
/** Kinds that rewrite a word into a dictionary word: on a capitalised original that is likely a name. */
export const WORD_REWRITE_KINDS = new Set(['Spelling', 'Typo']);
/** A capital then lowercase letters ("Teh", "Priya"; not "NPCI", "MEGHNA" or "A."). */
export const TITLE_CASE_WORD = /^\p{Lu}\p{Ll}+$/u;
const PLAIN_WORD = /^[\p{L}'’]+$/u;

/** One hyphen-separated part of an identifier: "q2", "mp4", "4K", "B2B", "COVID", "19" (not "y0u", "th9s"). */
const IDENTIFIER_PART = /^(?:\p{L}+\p{N}+|\p{N}+\p{L}+|[\p{Lu}\p{N}]+|\p{L}+|\p{N}+)$/u;
const HAS_LETTER = /\p{L}/u;
export const HAS_DIGIT = /\p{N}/u;
/** A capital right after a lowercase letter: "preventDefault", "iPhone", "DevTools". */
const INNER_CAPITAL = /\p{Ll}\p{Lu}/u;
/** Dotted or slashed code, lowercase after each separator: "et.reportAllChanges", "src/ui", "file.docx". */
const CODE_PATH = /^[\p{L}_$][\p{L}\p{N}_$]*(?:[./][\p{Ll}_$][\p{L}\p{N}_$]*)+$/u;
/** Characters a code token may hold; the token around a flag grows over them ("et" → "et.reportAllChanges"). */
const TOKEN_CHAR = /[\p{L}\p{N}_$./-]/u;
/** Separators at the edges of a grown token, e.g. the sentence's full stop in "file.docx." */
const EDGE_SEPARATORS = /^[./-]+|[./-]+$/gu;
/** A single letter, e.g. "s", "x" (after dropping "z."'s full stop). */
const SINGLE_LETTER = /^\p{L}$/u;
/** Single letters that are words: "a", "I" (and a lone "i", which should become "I"). */
const ONE_LETTER_WORDS = new Set(['a', 'A', 'I', 'i']);
/** Kinds whose suggestions on a code token are noise: respellings, splits ("max Length"), capitals. */
const CODE_NOISE_KINDS = new Set(['Spelling', 'Typo', 'Capitalization']);

/**
 * True for code and identifiers rather than prose: camelCase ("preventDefault", "iPhone"), dotted or
 * slashed paths ("window.location", "src/ui"), and letters-with-digits identifiers ("q2", "mp4",
 * "B2B", "COVID-19"). A digit inside a word ("y0u", "th9s") is a typo, not an identifier.
 */
export function looksLikeCode(token: string): boolean {
  if (INNER_CAPITAL.test(token) || CODE_PATH.test(token)) return true;
  return HAS_LETTER.test(token) && HAS_DIGIT.test(token) && token.split('-').every((part) => IDENTIFIER_PART.test(part));
}

/** The token around `span`: grown over code characters, without separators at its edges. */
function tokenAround(text: string, span: Span): string {
  let start = span.start;
  let end = span.end;
  while (start > 0 && TOKEN_CHAR.test(text[start - 1])) start--;
  while (end < text.length && TOKEN_CHAR.test(text[end])) end++;
  return text.slice(start, end).replace(EDGE_SEPARATORS, '');
}

/**
 * A flag whose suggestions are noise because the text is not a prose word: a respelling, split or
 * capital on a code token (`paraText` gives the token around it: "et" in "et.reportAllChanges"), or a
 * respelling of a stray single letter (a variable, list marker or unit: "x", "s", "z."). The fact lock
 * protects these tokens too; this keeps them out of review altogether.
 */
export function isCodeNoiseFlag(c: Candidate, paraText?: string): boolean {
  const token = paraText === undefined ? c.original.replace(EDGE_SEPARATORS, '') : tokenAround(paraText, c.span);
  if (CODE_NOISE_KINDS.has(c.kind) && looksLikeCode(token)) return true;
  return WORD_REWRITE_KINDS.has(c.kind) && SINGLE_LETTER.test(token) && !ONE_LETTER_WORDS.has(token);
}

/** Capitalised-word Spelling/Typo flags are almost always names (spec §5 names card). */
export function isNameFlag(c: Candidate): boolean {
  return WORD_REWRITE_KINDS.has(c.kind) && UPPER_START.test(c.original);
}

/** Damerau-Levenshtein (optimal string alignment) distance, case-insensitive, stopping early above 1. */
export function withinOneEdit(a: string, b: string): boolean {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (Math.abs(a.length - b.length) > 1) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length] <= 1;
}

/**
 * A dictionary fix is only safe when it is a plain slip of one letter inside one word (teh → the,
 * occured → occurred, dont → don't). Bigger jumps (panchayat → penchant) usually mean an unknown word,
 * not a typo, and joining or splitting words (borewell → bore well, up stairs → upstairs,
 * mid-day → midday) is a meaning or style choice: auto-applying them can change meaning.
 */
export function isSlipFix(c: Candidate): boolean {
  return isSlip(c.original, c.replacements[0]);
}

function isSlip(original: string, replacement: string): boolean {
  return PLAIN_WORD.test(original) && PLAIN_WORD.test(replacement) && withinOneEdit(original, replacement);
}

/**
 * True when `word` (exact case) appears somewhere in the document other than at a sentence start.
 * An opening bracket or quote is looked through: "spent (Joshi and Pawar, 2020)" is mid-sentence.
 */
function usedMidSentence(word: string, paraText: ReadonlyMap<number, string>): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The whole word, e.g. "Rao" in "met Rao." but not in "Raona".
  const wholeWord = new RegExp(`(?<![\\p{L}\\p{N}'’])${escaped}(?![\\p{L}\\p{N}'’])`, 'gu');
  for (const text of paraText.values()) {
    for (const m of text.matchAll(wholeWord)) {
      let start = m.index!;
      while (start > 0 && OPENERS.test(text[start - 1])) start--;
      if (!isSentenceStart(text, start)) return true;
    }
  }
  return false;
}

/**
 * A capitalised flag that is probably a typo, not a name: it starts a sentence (so its capital says
 * nothing), it has a one-letter fix ("Teh" → "The"), and the document never capitalises it mid-sentence,
 * where a name would be capitalised too. A word in capitals ("NPCI", a speaker label "MEGHNA") is never
 * one: its capitals are not from the sentence start. Without paragraph text nothing counts as a likely typo.
 */
export function isLikelyTypo(c: Candidate, paraText: ReadonlyMap<number, string> | undefined): boolean {
  const text = paraText?.get(c.paraId);
  if (!paraText || text === undefined || !isNameFlag(c) || !TITLE_CASE_WORD.test(c.original)) return false;
  if (!isSentenceStart(text, c.span.start) || !c.replacements.some((r) => isSlip(c.original, r))) return false;
  return !usedMidSentence(c.original, paraText);
}
