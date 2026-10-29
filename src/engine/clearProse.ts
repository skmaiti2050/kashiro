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

/** A line break, with the carriage return of a Windows break: "\n", "\r\n". */
const LINE_BREAK = /\r?\n/g;
/** A Markdown heading line: "## Setup". */
const HEADING = /^[ \t]*#{1,6}[ \t]/;
/**
 * A line that starts a block of its own: indented ("    make"), a Markdown heading, a quote, a table row or a "$ "
 * prompt ("## ", "> ", "| One |", "$ make"). A Windows prompt is maybe command text (maybeCommands.ts).
 */
const BLOCK_START = /^(?:[ \t]|#{1,6}[ \t]|>|\||\$[ \t])/;
/** A line that ends with a colon, so the next line is no continuation of its sentence ("Install it with:"). */
const ENDS_WITH_COLON = /:[ \t]*$/;
/**
 * A line's first word, after any opening quotes, brackets or emphasis, when it is a plain word followed by a space,
 * a closing mark or the line's end ("saw" in "saw the stall", "Who" in "“Who"; none in "./sync", "x=1", "3,912").
 */
const FIRST_PLAIN_WORD = /^["'“‘([*_]*(\p{L}+(?:['’-]\p{L}+)*)(?=[\s,.;:!?"'”’)\]*_]|$)/u;

/** Command text and words with a spelling flag in a paragraph: both are signs a line isn't prose. */
export interface LineSigns {
  /** Command text, surely and maybe (commands.ts). */
  commandText: readonly Span[];
  /** Words Harper flagged as spelling ("pnpm", "xcopy"). */
  unknownWords: readonly Span[];
}

/** The sentence of `text` that holds `at`, or null when `at` is in none (between sentences). */
function sentenceAt(text: string, at: number): Span | null {
  return sentenceSpans(text).find((s) => s.start <= at && at < s.end) ?? null;
}

/** The line of `text` that `at` is on, without its "\n" break. */
function lineSpanAt(text: string, at: number): Span {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const end = text.indexOf('\n', at);
  return { start, end: end === -1 ? text.length : end };
}

function lineAt(text: string, at: number): string {
  const line = lineSpanAt(text, at);
  return text.slice(line.start, line.end);
}

/**
 * `text` with each line break that only wraps prose replaced by spaces of the same length, so offsets stay exact
 * (Task F21b E1: hard-wrapped plain text and Markdown, such as an email at 72 columns). Joining only lets a doubling
 * tick, so it needs positive evidence (Task F24, F23 review I-5): the line above has text, no heading and no colon at
 * its end; the next line starts with a known word (no spelling flag: not "pnpm", "xcopy"), not with a block start
 * or a list label; and neither line touches command text. Otherwise each line stays a sentence of its own.
 */
function joinWrappedLines(text: string, signs: LineSigns): string {
  const touches = (spans: readonly Span[], part: Span) => spans.some((s) => s.start < part.end && s.end > part.start);
  const startsWithKnownWord = (line: Span) => {
    const word = FIRST_PLAIN_WORD.exec(text.slice(line.start, line.end));
    if (word === null) return false;
    const start = line.start + word[0].length - word[1].length;
    return !touches(signs.unknownWords, { start, end: start + word[1].length });
  };
  return text.replace(LINE_BREAK, (lineBreak: string, at: number) => {
    const before = lineSpanAt(text, at);
    const after = lineSpanAt(text, at + lineBreak.length);
    const [previous, next] = [text.slice(before.start, before.end), text.slice(after.start, after.end)];
    const wraps =
      previous.trim() !== '' &&
      !HEADING.test(previous) &&
      !ENDS_WITH_COLON.test(previous) &&
      !BLOCK_START.test(next) &&
      !LIST_LABEL.test(next) &&
      startsWithKnownWord(after) &&
      !touches(signs.commandText, before) &&
      !touches(signs.commandText, after);
    return wraps ? ' '.repeat(lineBreak.length) : lineBreak;
  });
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
 * the reader to run or type something, and touches no command text, surely or maybe (`signs.commandText`: a weak
 * sign anywhere in the sentence makes it maybe). A sentence hard-wrapped over several lines is read whole
 * (joinWrappedLines).
 */
export function isClearProseSentence(text: string, at: Span, signs: LineSigns): boolean {
  const { commandText } = signs;
  const joined = joinWrappedLines(text, signs);
  const span = sentenceAt(joined, at.start);
  if (span === null || at.end > span.end) return false;
  const sentence = joined.slice(span.start, span.end);
  if (!SENTENCE_CLOSE.test(sentence) || !SENTENCE_OPEN.test(sentence)) return false;
  if ((sentence.match(WORD)?.length ?? 0) < MIN_WORDS) return false;
  if (LIST_LABEL.test(lineAt(text, span.start))) return false;
  if (tellsToRunSomething(sentence)) return false;
  return !commandText.some((c) => c.start < span.end && c.end > span.start);
}
