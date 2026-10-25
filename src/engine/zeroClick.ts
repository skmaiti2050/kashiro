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

/** A sentence's end at the end of a line: "home.", "done?" (with a closing quote or bracket after it). */
const ENDS_SENTENCE = /[.?!]["”’)]*\s*$/u;

/** A one-line paragraph with a column gap and no sentence end: "Name      Rahul Sharma", "Score: India 250  Australia 245". */
function isKeyValueLine(text: string): boolean {
  // search, not test: COLUMN_GAP is global, and test would carry its lastIndex from one call to the next.
  return !LINE_BREAK.test(text) && text.search(COLUMN_GAP) !== -1 && !ENDS_SENTENCE.test(text);
}

/**
 * Ids of one-line paragraphs lined up with a neighbour: two or more key–value lines in a row (isKeyValueLine),
 * each its own paragraph. Their spaces are layout though no one paragraph shows it (F4 re-review 3, M-3).
 */
export function findAlignedParagraphs(paras: readonly Paragraph[]): Set<number> {
  const keyValue = paras.map((p) => isKeyValueLine(p.text));
  return new Set(paras.filter((_, i) => keyValue[i] && (keyValue[i - 1] || keyValue[i + 1])).map((p) => p.id));
}

/** True when `c` collapses a run of spaces between two words, outside locked, table and laid-out text. */
function collapsesSpaces(c: Candidate, paragraph: Paragraph, locked: Span[] | undefined, aligned: boolean): boolean {
  if (c.source !== 'rules' || c.replacements.length !== 1 || c.replacements[0] !== ' ' || !SPACE_RUN.test(c.original)) return false;
  const { text } = paragraph;
  // Two code units each side, so a character outside the BMP (a tag) is read whole.
  const before = text.slice(Math.max(0, c.span.start - 2), c.span.start);
  const after = String.fromCodePoint(text.codePointAt(c.span.end) ?? 0x20);
  if (before === '' || NOT_A_WORD_EDGE_AT_END.test(before) || NOT_A_WORD_EDGE.test(after)) return false;
  if (paragraph.tableCell || aligned || looksLaidOut(text)) return false;
  return !overlapsLocked(c, locked);
}

/**
 * True for a hygiene deletion of one invisible character, or a run of spaces collapsed between two words.
 * `aligned`: the paragraph lines up with its neighbours (findAlignedParagraphs), so its spaces are layout.
 */
export function isZeroClickChange(c: Candidate, paragraph: Paragraph, locked: Span[] | undefined, aligned: boolean): boolean {
  if (c.source === 'hygiene') return c.replacements.length === 1 && c.replacements[0] === '';
  return collapsesSpaces(c, paragraph, locked, aligned);
}
