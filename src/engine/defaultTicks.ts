import type { Candidate, Span } from './types';
import { isSlipDoubling } from './tiers';
import { doubledWord } from './wordFlags';

/**
 * Which fixes on the simple-fixes card start unticked (Tasks F6 and F8, owner decisions 2026-10-26). "Review and
 * apply all" applies every ticked fix with one click, so a fix starts ticked only when it belongs to a closed,
 * listed set: a doubled word on the slip allowlist (isSlipDoubling), one copy and the space between removed,
 * except the alphabet pair "A a".
 * Everything else starts unticked, however safe its shape looks. That includes every a/an swap: re-reviews 4 to 6
 * each found a new way a ticked one was wrong ("Class A office", "a equal b", "mother an father" for "and").
 * Capitals, "i" → "I", punctuation spacing, dot runs, other formatting, whitespace, spelling slips and the kinds
 * the user opted into start unticked too. Guessing from a fix's shape missed new cases in every review (F5
 * re-review 4), so nothing here is inferred from one.
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
  if (text === undefined || c.replacements.length !== 1 || ctx.optedIn(c) || isAlphabetPair(c)) return false;
  return text.slice(c.span.start, c.span.end) === c.original && isSlipDoubling(c, text);
}

/**
 * "A a": on an alphabet or phonics sheet ("A a, B b, C c") the capital is the letter, not a sentence-start
 * article, and position can't tell the two apart (F8 re-review 7, M-1). It stays on the card, unticked.
 */
function isAlphabetPair(c: Candidate): boolean {
  return doubledWord(c) === 'a' && c.original.startsWith('A');
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
