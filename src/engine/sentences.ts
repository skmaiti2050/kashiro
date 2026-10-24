import { followsAbbreviation } from './factLock';
import { overlaps, type Edit } from './sessionTypes';
import type { Span } from './types';

/**
 * The sentence at `span` of `paraText` with the edits inside it applied (edits from one paragraph,
 * sorted by position). Null when an edit crosses the sentence edge: a rewrite would undo half of it.
 */
export function sentenceWithEdits(paraText: string, span: Span, edits: Edit[]): string | null {
  let text = paraText.slice(span.start, span.end);
  // Right to left, so earlier offsets stay valid.
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i].span;
    const inside = e.start >= span.start && e.end <= span.end;
    if (!inside && overlaps(e, span)) return null;
    if (!inside) continue;
    text = text.slice(0, e.start - span.start) + edits[i].replacement + text.slice(e.end - span.start);
  }
  return text;
}

/**
 * A sentence end: . ? ! or a Hindi/Bengali danda (। ॥) with any closing quotes or brackets, before a space
 * (`?" ` in `he asked?" Then`), or a line break.
 */
const SENTENCE_END = /[.?!।॥]+["'”’)\]]*(?=\s)|\n/g;
/** A Markdown heading, list or quote marker at the start of a line, e.g. "## " or "- ". */
const LINE_MARKER = /^(?:#{1,6}|[-*+]|\d+[.)]|>)[ \t]+/;

/** The sentences of a paragraph as trimmed spans, without Markdown line markers. "Dr. Rao" and "e.g. this" do not end one. */
export function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  const push = (start: number, end: number) => {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    const marker = LINE_MARKER.exec(text.slice(start, end));
    if (marker && (start === 0 || text[start - 1] === '\n')) start += marker[0].length;
    if (start < end) spans.push({ start, end });
  };
  let start = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index! + m[0].length;
    let next = end;
    while (next < text.length && /[ \t]/.test(text[next])) next++;
    if (m[0] !== '\n' && followsAbbreviation(text, next)) continue;
    push(start, end);
    start = end;
  }
  push(start, text.length);
  return spans;
}
