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
export const SPACE_RUN = /^ {2,}$/;
/** Whitespace or an invisible character: a space run next to one is not between two words. */
const NOT_A_WORD_EDGE = /[\s\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const NOT_A_WORD_EDGE_AT_END = new RegExp(`${NOT_A_WORD_EDGE.source}$`, 'u');
/** A tab, or a line that starts with a space or tab: code, or text laid out by hand. */
const INDENT_OR_TAB = /\t|(?:^|[\r\n]) /;
/** A gap of two or more spaces after a word, not after a sentence's punctuation ("Pens    10", not "end.  Next"). */
const COLUMN_GAP = /(?<=[^\s.?!:;,]) {2,}(?=\S)/g;
const LINE_BREAK = /\r\n|\r|\n/;

/** A line of one to three words ending in a colon, then a gap of two or more spaces: "Name:      Rahul", "Address:  12 MG Road." */
const KEY_COLON_THEN_GAP = /^[^\s:]+(?: [^\s:]+){0,2}: {2,}\S/;

/**
 * True when the paragraph's spaces look like layout rather than slips: a tab or an indented line, a line with
 * two column gaps ("Name    Age    City"), two lines with one each (a small table lined up with spaces), or a
 * "Key:  value" line (even when the value ends with a full stop: skipping is the safe side, #8).
 */
function looksLaidOut(text: string): boolean {
  if (INDENT_OR_TAB.test(text)) return true;
  if (text.split(LINE_BREAK).some((line) => KEY_COLON_THEN_GAP.test(line))) return true;
  const gaps = text.split(LINE_BREAK).map((line) => line.match(COLUMN_GAP)?.length ?? 0);
  return gaps.some((n) => n >= 2) || gaps.filter((n) => n > 0).length >= 2;
}

/** A sentence's end at the end of a line: "home.", "done?", "होम।" (with a closing quote or bracket after it). */
const ENDS_SENTENCE = /[.?!।॥]["”’)]*\s*$/u;
/**
 * A gap of three or more spaces after a word or a key's colon: "Name:   Rahul", "Company     Acme Pvt. Ltd.";
 * not after a sentence end ("होम।   अगला").
 */
const WIDE_GAP = /(?<=[^\s.?!;,।॥]) {3,}(?=\S)/;
/** One to three words, then a gap of two or more spaces: "Total      500", "Date of birth:   1 May". */
const SHORT_KEY_THEN_GAP = /^\S+(?: \S+){0,2} {2,}\S/;

/**
 * A one-line paragraph laid out as a key and a value: a gap of three or more spaces, even when the line ends with
 * a full stop ("Company     Acme Pvt. Ltd."), or a column gap and no sentence end ("Score: India 250  Australia 245").
 */
function isKeyValueLine(text: string): boolean {
  if (LINE_BREAK.test(text)) return false;
  // search, not test: COLUMN_GAP is global, and test would carry its lastIndex from one call to the next.
  return WIDE_GAP.test(text) || (text.search(COLUMN_GAP) !== -1 && !ENDS_SENTENCE.test(text));
}

/** A key–value line that stands alone: a short key, a gap, no sentence end ("Total      500" between sentences). */
function isShortKeyValueLine(text: string): boolean {
  if (LINE_BREAK.test(text)) return false;
  return KEY_COLON_THEN_GAP.test(text) || (SHORT_KEY_THEN_GAP.test(text) && !ENDS_SENTENCE.test(text));
}

/**
 * Ids of one-line paragraphs whose spaces are layout though no one paragraph shows it: two or more key–value lines
 * in a row (isKeyValueLine), each its own paragraph (F4 re-review 3, M-3), or a short one alone (F5 re-review 4,
 * M-3). A sentence with a stray double space ends with its full stop, so it still collapses.
 */
export function findAlignedParagraphs(paras: readonly Paragraph[]): Set<number> {
  const keyValue = paras.map((p) => isKeyValueLine(p.text));
  const aligned = paras.filter((p, i) => (keyValue[i] && (keyValue[i - 1] || keyValue[i + 1])) || isShortKeyValueLine(p.text));
  return new Set(aligned.map((p) => p.id));
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
