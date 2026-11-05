import type { Candidate, Span } from './types';
import type { TrustPolicy } from './languageEngine';
import { isClearProseSentence } from './clearProse';
import { isSlipDoubling } from './tiers';
import { doubledWord } from './wordFlags';

/**
 * Which fixes on the simple-fixes card start unticked (Tasks F6 and F8, owner decisions 2026-10-26). "Review and
 * apply all" applies every ticked fix with one click, so a fix starts ticked only when it belongs to a closed,
 * listed set: a doubled word on the slip allowlist (isSlipDoubling), one copy and the space between removed,
 * except a doubled "a" or "an" in any case (isLetterPair), and only in a clear prose sentence (isClearProseSentence).
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
  /** The command text of a paragraph, surely and maybe (commands.ts): a sentence touching it is no clear prose. */
  commandText(paraId: number): readonly Span[];
  /** The words of a paragraph with a spelling flag: a line starting with one isn't joined to the prose above it. */
  unknownWords(paraId: number): readonly Span[];
  /** The tick list of the engine that checked a paragraph (its trust policy): 'none' ticks nothing there. */
  ticks(paraId: number): TrustPolicy['ticks'];
}

/** The ids of `fixes` (the card's members) that start unticked, in card order. */
export function untickedByDefault(fixes: readonly Candidate[], ctx: TickContext): string[] {
  const combined = combinedFixes(fixes, ctx.paraText);
  return fixes.filter((c) => combined.has(c.id) || !startsTicked(c, ctx)).map((c) => c.id);
}

function startsTicked(c: Candidate, ctx: TickContext): boolean {
  const text = ctx.paraText.get(c.paraId);
  if (text === undefined || c.replacements.length !== 1 || ctx.optedIn(c) || isLetterPair(c)) return false;
  if (ctx.ticks(c.paraId) === 'none') return false;
  if (text.slice(c.span.start, c.span.end) !== c.original || !isSlipDoubling(c, text)) return false;
  if (followsMentionWord(text, c.span)) return false;
  // Only in a clear prose sentence (Task F21d, owner decision 2026-10-29): elsewhere it may be command text.
  return isClearProseSentence(text, c.span, { commandText: ctx.commandText(c.paraId), unknownWords: ctx.unknownWords(c.paraId) });
}

/** A mention word and the space after it, at the end of the text before a fix: "use the keyword " (#38). */
const MENTION_WORD_BEFORE = /\b(?:keyword|command|option|flag)s?\s+$/iu;

/** How far back to look: the longest mention word plus a little space, so a long paragraph is never rescanned. */
const MENTION_LOOKBEHIND = 40;

/**
 * A doubled word right after "keyword", "command", "option" or "flag" ("use the keyword with with the path") may be
 * the keyword itself, as in a how-to; nothing marks it, so it is offered but never ticked.
 */
function followsMentionWord(text: string, span: Span): boolean {
  return MENTION_WORD_BEFORE.test(text.slice(Math.max(0, span.start - MENTION_LOOKBEHIND), span.start));
}

/** The doubled words that are also letters or sounds on a worksheet. */
const LETTER_WORDS: ReadonlySet<string> = new Set(['a', 'an']);

/**
 * A doubled "a" or "an" in any case ("A a", "a a", "An an"): on an alphabet or phonics sheet ("A a, B b", "Say the
 * sounds: a a, b b", "An an. Bn bn.") it is the letter or the sound, and nothing in the text tells it from the slip
 * "a a lot" or "an an apple" (F8 re-review 7, M-1; Tasks F10 and F11). It stays on the card, unticked.
 */
function isLetterPair(c: Candidate): boolean {
  return LETTER_WORDS.has(doubledWord(c) ?? '');
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
