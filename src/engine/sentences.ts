import { followsAbbreviation } from './factLock';
import type { Span } from './types';

/** A sentence end: . ? or ! with any closing quotes or brackets, before a space (`?" ` in `he asked?" Then`), or a line break. */
const SENTENCE_END = /[.?!]+["'”’)\]]*(?=\s)|\n/g;
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
