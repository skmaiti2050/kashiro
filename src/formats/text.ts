import type { Paragraph } from '../engine/types';
import type { Edit } from '../engine/session';
import type { FormatAdapter } from './types';
import { textProblem, UnreadableFileError } from './fileProblems';

interface TextHandle {
  /** Decoded file text without the BOM. */
  text: string;
  bom: boolean;
  /** paraId → absolute offset of the paragraph in `text`. */
  offsets: number[];
  lengths: number[];
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
/** A Markdown table's delimiter row, under its header row: "|---|:--:|", "--- | ---". */
const TABLE_DELIMITER = /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** A cell border in a table row: "|", but not an escaped "\|". */
const CELL_BORDER = /(?<!\\)\|/g;
const BLANK = /^\s*$/;

// `search` ignores the g flag's lastIndex, so the one regex serves both uses.
const hasCellBorder = (line: string) => line.search(CELL_BORDER) >= 0;

/** A line of the text: [start, end) without its line break. */
interface Line {
  start: number;
  end: number;
}

/** A line break in any convention: Windows "\r\n", Unix "\n", or old Mac "\r" alone (review #4). */
const LINE_BREAK = /\r\n|\r|\n/g;

/** The lines of `text`; the breaks themselves stay in the text, so a write keeps each line's own ending. */
function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const m of text.matchAll(LINE_BREAK)) {
    lines.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  lines.push({ start, end: text.length });
  return lines;
}

/** The text cells of a table row, trimmed, as [start, end) in `text`: "| a | b |" → "a", "b" (empty cells left out). */
function tableCells(text: string, line: Line): Line[] {
  const row = text.slice(line.start, line.end);
  const borders = [-1, ...[...row.matchAll(CELL_BORDER)].map((m) => m.index!), row.length];
  const cells: Line[] = [];
  for (let i = 1; i < borders.length; i++) {
    const cell = row.slice(borders[i - 1] + 1, borders[i]);
    const trimmed = cell.trim();
    if (!trimmed) continue;
    const start = line.start + borders[i - 1] + 1 + (cell.length - cell.trimStart().length);
    cells.push({ start, end: start + trimmed.length });
  }
  return cells;
}

/**
 * Paragraphs are blocks separated by blank (empty or whitespace-only) lines. Line endings are kept inside a paragraph.
 * With `markdown`:
 * - blank lines inside a ``` or ~~~ code block do not split it, so the whole block reaches the linter as one
 *   paragraph that its Markdown parser skips as code;
 * - a table (a block whose second line is a delimiter row) gives one paragraph per cell, as the linter checks a
 *   table's cells anyway: one 2,000-row paragraph took ~40 s to check (Task U3 fix 1). The table ends at a blank
 *   line or a line without a cell border.
 */
function split(text: string, markdown: boolean): { paras: Paragraph[]; offsets: number[]; lengths: number[] } {
  const paras: Paragraph[] = [];
  const offsets: number[] = [];
  const lengths: number[] = [];
  /** A blank line came after the last paragraph added (Paragraph.afterBlankLine). */
  let blankSince = false;
  const add = (start: number, end: number, tableCell = false) => {
    const afterBlankLine = blankSince && paras.length > 0;
    paras.push({ id: paras.length, text: text.slice(start, end), ...(tableCell ? { tableCell } : {}), ...(afterBlankLine ? { afterBlankLine } : {}) });
    blankSince = false;
    offsets.push(start);
    lengths.push(end - start);
  };
  const lines = linesOf(text);
  const lineText = (i: number) => text.slice(lines[i].start, lines[i].end);
  const startsTable = (i: number) => i + 1 < lines.length && hasCellBorder(lineText(i)) && TABLE_DELIMITER.test(lineText(i + 1));
  let start = -1;
  let end = -1;
  const flush = () => {
    if (start >= 0) add(start, end);
    start = -1;
  };
  /** The open fence marker (e.g. "```"), or null outside a code block. */
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lineText(i);
    const blank = BLANK.test(line);
    if (markdown && fence === null && start < 0 && !blank && startsTable(i)) {
      tableCells(text, lines[i]).forEach((c) => add(c.start, c.end, true));
      for (i += 2; i < lines.length && hasCellBorder(lineText(i)); i++) {
        tableCells(text, lines[i]).forEach((c) => add(c.start, c.end, true));
      }
      i--; // the line that ended the table is read as usual
      continue;
    }
    let closes = false;
    if (markdown) {
      const m = FENCE_OPEN.exec(line);
      if (fence === null) fence = m ? m[1] : null;
      else closes = !!m && m[1][0] === fence[0] && m[1].length >= fence.length && BLANK.test(line.slice(m[0].length));
    }
    if (!blank) {
      if (start < 0) start = lines[i].start;
      end = lines[i].end;
    } else if (fence === null) {
      flush(); // a blank line inside a code block belongs to the paragraph
      blankSince = true;
    }
    if (closes) fence = null;
  }
  flush();
  return { paras, offsets, lengths };
}

/** Paragraph id → its start in the file's text (without a byte-order mark), from a text adapter's read handle. */
export function textParagraphStarts(handle: unknown): Map<number, number> {
  return new Map((handle as TextHandle).offsets.map((offset, id) => [id, offset]));
}

/** Half of a surrogate pair standing alone: UTF-8 can't encode it, so it would be written as U+FFFD. */
const LONE_SURROGATE = /\p{Cs}/u;

const isHigh = (c: string | undefined) => c !== undefined && c >= '\u{D800}' && c <= '\u{DBFF}';
const isLow = (c: string | undefined) => c !== undefined && c >= '\u{DC00}' && c <= '\u{DFFF}';

/** Why `edit` can't be written into the file, or null; the same character checks as the .docx writer (review #4). */
function editProblem(handle: TextHandle, edit: Edit): string | null {
  const off = handle.offsets[edit.paraId];
  const { start, end } = edit.span;
  if (off === undefined || start < 0 || end < start || end > handle.lengths[edit.paraId]) return 'paragraph or span not found';
  for (const at of [off + start, off + end]) {
    if (isHigh(handle.text[at - 1]) && isLow(handle.text[at])) return 'the span splits a character';
  }
  if (LONE_SURROGATE.test(edit.replacement)) return 'the replacement contains half a character';
  return null;
}

function make(exts: string[], language: 'plaintext' | 'markdown'): FormatAdapter {
  return {
    exts,
    language,
    async read(bytes) {
      const problem = textProblem(bytes);
      if (problem) throw problem;
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw new UnreadableFileError('notUtf8', 'not UTF-8 text (it may be saved as Windows-1252 or another code page)');
      }
      const bom = text.charCodeAt(0) === 0xfeff;
      if (bom) text = text.slice(1);
      const { paras, offsets, lengths } = split(text, language === 'markdown');
      const handle: TextHandle = { text, bom, offsets, lengths };
      return { paras, handle };
    },
    // `mode` is ignored: plain text has no tracked changes, so output is always clean.
    async write(h, edits) {
      const handle = h as TextHandle;
      const unplaceable: { edit: Edit; reason: string }[] = [];
      const abs: { start: number; end: number; replacement: string }[] = [];
      for (const edit of edits) {
        const reason = editProblem(handle, edit);
        if (reason) {
          unplaceable.push({ edit, reason });
          continue;
        }
        const off = handle.offsets[edit.paraId];
        abs.push({ start: off + edit.span.start, end: off + edit.span.end, replacement: edit.replacement });
      }
      abs.sort((a, b) => b.start - a.start || b.end - a.end);
      let out = handle.text;
      for (const e of abs) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
      if (handle.bom) out = '\u{FEFF}' + out;
      return { bytes: new TextEncoder().encode(out), unplaceable };
    },
  };
}

export const plaintextAdapter = make(['.txt'], 'plaintext');
export const markdownAdapter = make(['.md', '.markdown'], 'markdown');
