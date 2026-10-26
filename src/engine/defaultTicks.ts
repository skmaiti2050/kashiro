import type { Candidate, Span } from './types';
import { isSlipDoubling } from './tiers';
import { startsWord } from './wordFlags';
import { VETTED_ARTICLES } from './wordlists/articles';

/**
 * Which fixes on the simple-fixes card start unticked (Task F6, owner decision 2026-10-26). "Review and apply all"
 * applies every ticked fix with one click, so a fix starts ticked only when it belongs to a closed, listed set:
 *   (a) a doubled word on the slip allowlist (isSlipDoubling), one copy and the space between removed;
 *   (b) an a/an swap before a word in the vetted table (wordlists/articles.ts), toward the article listed there.
 * Everything else starts unticked, however safe its shape looks: capitals, "i" → "I", punctuation spacing, dot
 * runs, other formatting, whitespace, spelling slips and the kinds the user opted into. Guessing from a fix's
 * shape missed new cases in every review (F5 re-review 4), so nothing here is inferred from one.
 */

export interface TickContext {
  /** paraId → paragraph text. */
  paraText: ReadonlyMap<number, string>;
  /** A fix of a kind the user added in Settings, not a built-in simple fix: never ticked (owner decision 2026-10-25). */
  optedIn(c: Candidate): boolean;
}

/** The ids of `fixes` (the card's members) that start unticked, in card order. */
export function untickedByDefault(fixes: readonly Candidate[], ctx: TickContext): string[] {
  const combined = combinedFixes(fixes, ctx.paraText);
  return fixes.filter((c) => combined.has(c.id) || !startsTicked(c, ctx)).map((c) => c.id);
}

function startsTicked(c: Candidate, ctx: TickContext): boolean {
  const text = ctx.paraText.get(c.paraId);
  if (text === undefined || c.replacements.length !== 1 || ctx.optedIn(c)) return false;
  if (text.slice(c.span.start, c.span.end) !== c.original) return false;
  return isSlipDoubling(c, text) || isVettedArticleSwap(c, text);
}

/** The article swaps that may be ticked, in the original's case: "a" → "an", "A" → "An", and back. */
const ARTICLE_SWAPS = new Map([
  ['a', 'an'],
  ['an', 'a'],
  ['A', 'An'],
  ['An', 'A'],
]);
/**
 * The word after an article: one space or line break, then letters ending at a space, the end, a hyphen,
 * an apostrophe or punctuation ("apple" in "an apple.", "one" in "a one-off"; not "apple" in "a apple2" or
 * "a m<U+200E>ean", nor "apple" after "a *").
 */
const NEXT_WORD = /^[ \n](\p{L}+)(?=$|[\s.,;:!?)\]}"”’'-])/u;
/** A lowercase or capitalised word ("apple", "European"), not an initialism ("USB", "HR") or "iPhone". */
const PLAIN_OR_CAPITALISED = /^\p{Lu}?\p{Ll}+$/u;

/**
 * An a ↔ an swap, as a word of its own, whose next word is in the vetted table (compared in lowercase) and takes
 * the article the swap writes: "a apple" → "an", "an useful" → "a". "an unidentified" → "a" is not ticked: the
 * table says "an" (F5 re-review 4, I-1).
 */
function isVettedArticleSwap(c: Candidate, text: string): boolean {
  const [replacement] = c.replacements;
  if (c.kind !== 'Miscellaneous' || ARTICLE_SWAPS.get(c.original) !== replacement) return false;
  if (!startsWord(text, c.span.start)) return false;
  const next = NEXT_WORD.exec(text.slice(c.span.end))?.[1] ?? '';
  return PLAIN_OR_CAPITALISED.test(next) && VETTED_ARTICLES.get(next.toLowerCase()) === replacement.toLowerCase();
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
