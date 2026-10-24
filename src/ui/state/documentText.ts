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
