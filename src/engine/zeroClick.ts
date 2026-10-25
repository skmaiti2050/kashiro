import { overlapsLocked } from './factLock';
import type { Candidate, Paragraph, Span } from './types';

/**
 * The only changes Kashiro makes without a click (owner decision, Task F4; CLAUDE.md rule #1). Everything else,
 * however safe its rule looks, waits for the user: most of it on the one "simple fixes" card.
 *   (a) deleting an invisible character hygiene flagged with its fix (findInvisible keeps what a script needs);
 *   (b) collapsing a run of spaces between two words to one, outside protected text and laid-out text.
 * tokenGuard's keepsTokens checks the result independently.
 */

/** Two or more plain spaces: "  " in "went  home". */
const SPACE_RUN = /^ {2,}$/;
/** Whitespace or an invisible character: a space run next to one is not between two words. */
const NOT_A_WORD_EDGE = /[\s\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const NOT_A_WORD_EDGE_AT_END = new RegExp(`${NOT_A_WORD_EDGE.source}$`, 'u');
/** A tab, or a line that starts with a space or tab: code, or text laid out by hand. */
const INDENT_OR_TAB = /\t|(?:^|[\r\n]) /;
/** A gap of two or more spaces after a word, not after a sentence's punctuation ("Pens    10", not "end.  Next"). */
const COLUMN_GAP = /(?<=[^\s.?!:;,]) {2,}(?=\S)/g;
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * True when the paragraph's spaces look like layout rather than slips: a tab or an indented line, a line with
 * two column gaps ("Name    Age    City"), or two lines with one each (a small table lined up with spaces).
 */
function looksLaidOut(text: string): boolean {
  if (INDENT_OR_TAB.test(text)) return true;
  const gaps = text.split(LINE_BREAK).map((line) => line.match(COLUMN_GAP)?.length ?? 0);
  return gaps.some((n) => n >= 2) || gaps.filter((n) => n > 0).length >= 2;
}

/** True when `c` collapses a run of spaces between two words, outside locked, table and laid-out text. */
function collapsesSpaces(c: Candidate, paragraph: Paragraph, locked: Span[] | undefined): boolean {
  if (c.source !== 'rules' || c.replacements.length !== 1 || c.replacements[0] !== ' ' || !SPACE_RUN.test(c.original)) return false;
  const { text } = paragraph;
  // Two code units each side, so a character outside the BMP (a tag) is read whole.
  const before = text.slice(Math.max(0, c.span.start - 2), c.span.start);
  const after = String.fromCodePoint(text.codePointAt(c.span.end) ?? 0x20);
  if (before === '' || NOT_A_WORD_EDGE_AT_END.test(before) || NOT_A_WORD_EDGE.test(after)) return false;
  if (paragraph.tableCell || looksLaidOut(text)) return false;
  return !overlapsLocked(c, locked);
}

/** True for a hygiene deletion of one invisible character, or a run of spaces collapsed between two words. */
export function isZeroClickChange(c: Candidate, paragraph: Paragraph, locked: Span[] | undefined): boolean {
  if (c.source === 'hygiene') return c.replacements.length === 1 && c.replacements[0] === '';
  return collapsesSpaces(c, paragraph, locked);
}
