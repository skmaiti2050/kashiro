import type { Paragraph } from '@/engine/types';

/**
 * Where each paragraph starts in `text`, for paragraphs that are slices of it in order (the text
 * adapters' blank-line split). Each one starts at the first line start at or after the previous
 * paragraph's end that matches it: the lines in between are blank, and a blank line can't match a
 * paragraph's first line (which has a non-space character before its line break).
 */
export function paragraphStarts(text: string, paras: Paragraph[]): Map<number, number> {
  const starts = new Map<number, number>();
  let from = 0;
  for (const p of paras) {
    let at = text.indexOf(p.text, from);
    while (at > 0 && text[at - 1] !== '\n') at = text.indexOf(p.text, at + 1);
    if (at < 0) throw new Error(`paragraph ${p.id} is not in the document text`);
    starts.set(p.id, at);
    from = at + p.text.length;
  }
  return starts;
}

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
 * Old paragraph id → new paragraph id, for paragraphs whose text did not change. Duplicated texts pair
 * up in order (the first old "A." with the first new "A.").
 */
export function matchUnchangedParagraphs(before: Paragraph[], after: Paragraph[]): Map<number, number> {
  const oldIdsByText = new Map<string, number[]>();
  for (const p of before) oldIdsByText.set(p.text, [...(oldIdsByText.get(p.text) ?? []), p.id]);
  const matched = new Map<number, number>();
  for (const p of after) {
    const oldId = oldIdsByText.get(p.text)?.shift();
    if (oldId !== undefined) matched.set(oldId, p.id);
  }
  return matched;
}

/** `/docs/essay.docx` + `.checked` → `/docs/essay.checked.docx`; `ext` replaces the extension. */
export function siblingPath(path: string, suffix: string, ext?: string): string {
  const nameStart = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
  const dot = path.lastIndexOf('.');
  const hasExt = dot > nameStart;
  const stem = hasExt ? path.slice(0, dot) : path;
  return stem + suffix + (ext ?? (hasExt ? path.slice(dot) : ''));
}
