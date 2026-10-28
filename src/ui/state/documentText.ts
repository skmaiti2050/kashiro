import { pairParagraphKeys, type ParagraphMatch } from '@/engine/carryDecisions';
import type { Paragraph } from '@/engine/types';

/** The view text of a document without its own plain text (.docx): paragraphs separated by a blank line. */
export function joinParagraphs(paras: Paragraph[]): { text: string; starts: Map<number, number> } {
  const starts = new Map<number, number>();
  let text = '';
  for (const p of paras) {
    if (text) text += '\n\n';
    starts.set(p.id, text.length);
    text += p.text;
  }
  return { text, starts };
}

/**
 * Old paragraph id → new paragraph id (`unchanged`), for paragraphs whose text did not change. The same list (a
 * goal or settings change, a .docx re-check) maps each paragraph to itself, copies included (final F15 review
 * M-14). Otherwise a text found in more than one paragraph, before or after, is never matched: which copy is which
 * can't be told, so its decisions are not carried and its places come back for review (owner decision, Task F15).
 * Such a paragraph's `copies` are the new ids with its text (see carryDecisions).
 */
export function matchParagraphs(before: Paragraph[], after: Paragraph[]): ParagraphMatch {
  const { unchanged, copies } = pairParagraphKeys(
    before.map((p) => p.text),
    after.map((p) => p.text),
  );
  return {
    unchanged: new Map([...unchanged].map(([i, j]) => [before[i].id, after[j].id])),
    copies: new Map([...copies].map(([i, js]) => [before[i].id, js.map((j) => after[j].id)])),
  };
}

/** True when both lists hold the same paragraphs (ids and text) in the same order. */
export function sameParagraphs(a: Paragraph[], b: Paragraph[]): boolean {
  return a.length === b.length && a.every((p, i) => p.id === b[i].id && p.text === b[i].text);
}

/** `/docs/essay.docx` + `.checked` → `/docs/essay.checked.docx`; `ext` replaces the extension. */
export function siblingPath(path: string, suffix: string, ext?: string): string {
  const nameStart = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
  const dot = path.lastIndexOf('.');
  const hasExt = dot > nameStart;
  const stem = hasExt ? path.slice(0, dot) : path;
  return stem + suffix + (ext ?? (hasExt ? path.slice(dot) : ''));
}
