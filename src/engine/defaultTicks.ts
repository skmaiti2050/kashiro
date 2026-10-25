import type { Candidate, Span } from './types';
import { followsClearSentenceEnd } from './factLock';
import { endsWord, startsWord } from './wordFlags';

/**
 * Which fixes on the simple-fixes card start unticked (Task F5, F4 re-review 3). "Review and apply all" applies
 * every ticked fix with one click, so a fix starts ticked only when it passes every check below, whatever rule
 * made it; the others are listed unticked, for the user to read and tick. Like zeroClick.ts, this is a gate on
 * the shape of the change, not a list of the shapes that went wrong before.
 */

export interface TickContext {
  /** paraId → paragraph text. */
  paraText: ReadonlyMap<number, string>;
  /** A fix of a kind the user added in Settings, not a built-in simple fix: never ticked (owner decision 2026-10-25). */
  optedIn(c: Candidate): boolean;
  /** Lowercased words after an article fix that the spell checker knows (sessionSetup's articleNextWords). */
  dictionaryWords: ReadonlySet<string>;
}

/** The ids of `fixes` (the card's members) that start unticked, in card order. */
export function untickedByDefault(fixes: readonly Candidate[], ctx: TickContext): string[] {
  const combined = combinedFixes(fixes, ctx.paraText);
  return fixes.filter((c) => combined.has(c.id) || !startsTicked(c, ctx)).map((c) => c.id);
}

function startsTicked(c: Candidate, ctx: TickContext): boolean {
  const text = ctx.paraText.get(c.paraId);
  if (text === undefined || c.replacements.length !== 1 || ctx.optedIn(c)) return false;
  const [replacement] = c.replacements;
  // Spaces the zero-click rule left alone are layout (a table cell, columns, an indent, a tab), or next to an
  // invisible character: they are why the fix is on the card at all (F4 re-review 3, M-4).
  if (ONLY_WHITESPACE.test(c.original) && ONLY_WHITESPACE.test(replacement)) return false;
  if (!isWholeWordFix(text, c.span)) return false;
  if (!keepsCase(c.original, replacement, text, c.span.start)) return false;
  return !isArticleFix(c) || isPlainDictionaryWord(nextWord(text, c.span.end), ctx.dictionaryWords);
}

const ONLY_WHITESPACE = /^\s*$/u;
/** A letter, digit or mark: an edge of the fix that holds one must be a word boundary. */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

/**
 * True when the fix starts and ends on word boundaries, by the doubling rule's own check (isWholeWords): "Ph" →
 * "pH" in "Ph.D." does not end one. An edge that is a space or punctuation mark is a boundary already.
 */
function isWholeWordFix(text: string, { start, end }: Span): boolean {
  const startsOk = !WORD_CHARACTER.test(text[start] ?? '') || startsWord(text, start);
  return startsOk && (!WORD_CHARACTER.test(text[end - 1] ?? '') || endsWord(text, end));
}

type CaseShape = 'none' | 'lower' | 'title' | 'upper' | 'mixed';

/** "apple" lower; "A", "I" and "Apple" title; "AN" upper; "iPhone" mixed; "," none (no letter has case). */
export function caseShape(text: string): CaseShape {
  const letters = [...text].filter((ch) => ch.toLowerCase() !== ch.toUpperCase());
  const upper = (ch: string) => ch !== ch.toLowerCase();
  if (letters.length === 0) return 'none';
  if (!letters.some(upper)) return 'lower';
  if (upper(letters[0]) && !letters.slice(1).some(upper)) return 'title';
  return letters.every(upper) ? 'upper' : 'mixed';
}

/**
 * True when the replacement keeps the original's case ("teh" → "the", "A" → "An"; not "A" → "AN"). A fix of the
 * case alone is a deliberate capitalisation, ticked in two shapes only: a whole word upper-cased ("usb" → "USB",
 * "i" → "I"), or a first letter capitalised where a sentence surely starts (followsClearSentenceEnd).
 */
function keepsCase(original: string, replacement: string, text: string, at: number): boolean {
  if (original.toLowerCase() !== replacement.toLowerCase()) return caseShape(original) === caseShape(replacement);
  if (replacement === original.toUpperCase() && (original.length >= 2 || original === 'i')) return true;
  const capitalised = caseShape(original) === 'lower' && replacement === original[0].toUpperCase() + original.slice(1);
  return capitalised && followsClearSentenceEnd(text, at);
}

/** An a ↔ an swap, in any case. */
export function isArticleFix(c: Candidate): boolean {
  const pair = [c.original.toLowerCase(), (c.replacements[0] ?? '').toLowerCase()].sort().join(' ');
  return c.kind === 'Miscellaneous' && c.replacements.length === 1 && pair === 'a an';
}

/** The word after an article: "lpg" in "an lpg cylinder". */
const NEXT_WORD = /^\s+([\p{L}\p{N}'’-]+)/u;
const VOWEL = /[aeiou]/u;

/** The word right after `end` in `text`, or ''. */
export function nextWord(text: string, end: number): string {
  return NEXT_WORD.exec(text.slice(end))?.[1] ?? '';
}

/**
 * True for a lowercase word of four or more letters with a vowel that the spell checker knows: what an article
 * swap can be ticked before. A shorter or vowelless word may be an initialism read letter by letter ("an lpg",
 * "an sms", "an hr", "an fir"), or a word whose sound its spelling doesn't tell ("a ewe"); Harper guesses both by
 * their letters (F4 re-review 3, I-3). Unticked, they are still offered.
 */
function isPlainDictionaryWord(word: string, dictionary: ReadonlySet<string>): boolean {
  return word.length >= 4 && caseShape(word) === 'lower' && VOWEL.test(word) && dictionary.has(word);
}

/** Whitespace-separated tokens: "a SMS" is two. */
const TOKEN = /\S+/gu;

/**
 * The ids of fixes that touch the same or adjacent tokens as another fix in their paragraph: each may be right
 * alone and wrong together ("an sms": "an" → "a" and "sms" → "SMS" make "a SMS"), so neither is ticked.
 */
function combinedFixes(fixes: readonly Candidate[], paraText: ReadonlyMap<number, string>): Set<string> {
  const out = new Set<string>();
  const tokenSpans = new Map<number, Span[]>();
  const tokensOf = (paraId: number) => {
    let spans = tokenSpans.get(paraId);
    if (!spans) {
      spans = [...(paraText.get(paraId) ?? '').matchAll(TOKEN)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
      tokenSpans.set(paraId, spans);
    }
    return spans;
  };
  const ranges = fixes.map((c) => tokenRange(tokensOf(c.paraId), c.span));
  fixes.forEach((a, i) => {
    fixes.forEach((b, j) => {
      if (i === j || a.paraId !== b.paraId) return;
      const [x, y] = [ranges[i], ranges[j]];
      if (x.first <= y.last + 1 && y.first <= x.last + 1) out.add(a.id);
    });
  });
  return out;
}

/** The first and last token `span` touches; spaces between two tokens touch both. */
function tokenRange(tokens: readonly Span[], span: Span): { first: number; last: number } {
  const touched = tokens.flatMap((t, i) => (t.start < Math.max(span.end, span.start + 1) && t.end > span.start ? [i] : []));
  if (touched.length > 0) return { first: touched[0], last: touched.at(-1)! };
  const after = tokens.findIndex((t) => t.start >= span.end);
  const next = after === -1 ? tokens.length : after;
  return { first: next - 1, last: next };
}
