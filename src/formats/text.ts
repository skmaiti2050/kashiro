import type { Paragraph } from '../engine/types';
import type { Edit } from '../engine/session';
import type { FormatAdapter } from './types';

interface TextHandle {
  /** Decoded file text without the BOM. */
  text: string;
  bom: boolean;
  /** paraId → absolute offset of the paragraph in `text`. */
  offsets: number[];
  lengths: number[];
}

/** Paragraphs are blocks separated by blank (empty or whitespace-only) lines. Line endings are kept inside a paragraph. */
function split(text: string): { paras: Paragraph[]; offsets: number[]; lengths: number[] } {
  const paras: Paragraph[] = [];
  const offsets: number[] = [];
  const lengths: number[] = [];
  let start = -1;
  let end = -1;
  const flush = () => {
    if (start < 0) return;
    paras.push({ id: paras.length, text: text.slice(start, end) });
    offsets.push(start);
    lengths.push(end - start);
    start = -1;
  };
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const contentEnd = lineEnd > pos && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    if (/^\s*$/.test(text.slice(pos, contentEnd))) {
      flush();
    } else {
      if (start < 0) start = pos;
      end = contentEnd;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  flush();
  return { paras, offsets, lengths };
}

function make(exts: string[], language: 'plaintext' | 'markdown'): FormatAdapter {
  return {
    exts,
    language,
    async read(bytes) {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw new Error('not UTF-8 text');
      }
      const bom = text.charCodeAt(0) === 0xfeff;
      if (bom) text = text.slice(1);
      const { paras, offsets, lengths } = split(text);
      const handle: TextHandle = { text, bom, offsets, lengths };
      return { paras, handle };
    },
    // `mode` is ignored: plain text has no tracked changes, so output is always clean.
    async write(h, edits) {
      const handle = h as TextHandle;
      const unplaceable: { edit: Edit; reason: string }[] = [];
      const abs: { start: number; end: number; replacement: string }[] = [];
      for (const edit of edits) {
        const off = handle.offsets[edit.paraId];
        if (off === undefined || edit.span.start < 0 || edit.span.end < edit.span.start || edit.span.end > handle.lengths[edit.paraId]) {
          unplaceable.push({ edit, reason: 'paragraph or span not found' });
          continue;
        }
        abs.push({ start: off + edit.span.start, end: off + edit.span.end, replacement: edit.replacement });
      }
      abs.sort((a, b) => b.start - a.start || b.end - a.end);
      let out = handle.text;
      for (const e of abs) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
      if (handle.bom) out = '﻿' + out;
      return { bytes: new TextEncoder().encode(out), unplaceable };
    },
  };
}

export const plaintextAdapter = make(['.txt'], 'plaintext');
export const markdownAdapter = make(['.md', '.markdown'], 'markdown');
