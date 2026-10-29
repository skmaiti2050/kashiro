import type { Span } from './types';
import { LIST_LABEL } from './commandShapes';
import { sentenceSpans } from './sentences';
import { FUNCTION_WORDS } from './tiers';

/**
 * A doubling starts ticked only in a clear prose sentence (Task F21d, owner decision 2026-10-29). Each review found
 * a new command shape whose doubling started ticked (F21 I-1, I-2, F21c I-3), so instead of detecting one more
 * shape, a tick needs positive evidence of prose. Anything else is still offered, unticked.
 */

/** A sentence's end: ".", "!" or "?", then any closing quotes or brackets ("…the mat.", "…he said.”", "(…soon.)"). */
const SENTENCE_CLOSE = /[.!?]["'”’)\]]*$/u;
/**
 * A sentence's start: a capital or a digit, after any opening quotes, brackets or Markdown emphasis ("The", "3,912",
 * "“We", "(He", "**NANDINI:**").
 */
const SENTENCE_OPEN = /^(?:\p{N}|["'“‘([*_]*\p{Lu})/u;
/**
 * Telling the reader to run or type something, then a word that isn't a function word ("run make the the target",
 * "Type echo the the", "Run - make", "run backup the the db"; not "run the shop", "enter your name").
 */
const RUN_SOMETHING = /(?<![\p{L}\p{N}_-])(?:run|type|enter|execute|paste)[ \t]+(?:-[ \t]+)?(\p{L}[\p{L}\p{N}_.-]*)/giu;
/** Whitespace-separated words. */
const WORD = /\S+/g;
/** Fewest words in a clear sentence: "make the the build" has four, but no capital or end mark. */
const MIN_WORDS = 4;

/** The sentence of `text` that holds `at`, or null when `at` is in none (between sentences). */
function sentenceAt(text: string, at: number): Span | null {
  return sentenceSpans(text).find((s) => s.start <= at && at < s.end) ?? null;
}

/** The line of `text` that `at` is on, without its break. */
function lineAt(text: string, at: number): string {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const end = text.indexOf('\n', at);
  return text.slice(start, end === -1 ? text.length : end);
}

/** True when the sentence tells the reader to run or type something that isn't a function word. */
function tellsToRunSomething(sentence: string): boolean {
  for (const m of sentence.matchAll(RUN_SOMETHING)) if (!FUNCTION_WORDS.has(m[1].toLowerCase())) return true;
  return false;
}

/**
 * True when the sentence of `text` holding `at` is a clear prose sentence, so a doubling in it may start ticked: it
 * ends with ".", "!" or "?" (and any closing quotes or brackets), starts with a capital or a digit (after any opening
 * quote, bracket or Markdown emphasis), has at least four words, isn't on a line with a list label, doesn't tell
 * the reader to run or type something, and touches no command text, surely or maybe (`commandText`: a weak sign
 * anywhere in the sentence makes it maybe).
 */
export function isClearProseSentence(text: string, at: Span, commandText: readonly Span[]): boolean {
  const span = sentenceAt(text, at.start);
  if (span === null || at.end > span.end) return false;
  const sentence = text.slice(span.start, span.end);
  if (!SENTENCE_CLOSE.test(sentence) || !SENTENCE_OPEN.test(sentence)) return false;
  if ((sentence.match(WORD)?.length ?? 0) < MIN_WORDS) return false;
  if (LIST_LABEL.test(lineAt(text, span.start))) return false;
  if (tellsToRunSomething(sentence)) return false;
  return !commandText.some((c) => c.start < span.end && c.end > span.start);
}
