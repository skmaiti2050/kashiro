import type { CheckSession } from '@/engine/session';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { categoryOf, type Category } from './categories';
import type { OpenDocument } from './sessionController';

/** One highlight in the document view, as offsets into the view text. */
export interface Highlight {
  from: number;
  to: number;
  /** auto: auto-fix (subtle); accepted: the user's edit; pending: a decision still open (underlined). */
  kind: 'auto' | 'accepted' | 'pending';
  /** For applied edits: the new text, shown after the struck-through original. */
  replacement?: string;
  /** For pending ones: the flag's message and flagged text, for its plain explanation on hover. */
  flag?: Pick<Candidate, 'message' | 'original' | 'kind' | 'source'>;
  /** For pending ones: the flag, so clicking the underline can bring up its card. */
  candidateId?: string;
  /** For pending ones: sets the underline's colour, style and glyph. */
  category?: Category;
}

/**
 * String offset in the view text → CodeMirror position. CodeMirror counts every line break as one
 * position, so with a CRLF separator each "\r\n" before the offset counts one less.
 */
export function toEditorPosition(text: string, lineSeparator: '\n' | '\r\n'): (offset: number) => number {
  if (lineSeparator === '\n') return (offset) => offset;
  const breaks: number[] = [];
  for (let i = text.indexOf('\r\n'); i >= 0; i = text.indexOf('\r\n', i + 2)) breaks.push(i);
  return (offset) => {
    let before = 0; // CRLFs that end at or before `offset` (binary search: breaks are sorted)
    let hi = breaks.length;
    while (before < hi) {
      const mid = (before + hi) >> 1;
      if (breaks[mid] + 2 <= offset) before = mid + 1;
      else hi = mid;
    }
    return offset - before;
  };
}

/**
 * Where a candidate sits in the view text, for "show me where" on a review item. Null while the view
 * shows text the session has not checked yet.
 */
export function locateCandidate(doc: OpenDocument, viewText: string, session: CheckSession, candidate: Candidate): { from: number; to: number } | null {
  if (viewText !== doc.text) return null;
  const para = session.paragraphs().find((p) => p.id === candidate.paraId);
  const start = doc.paraStarts.get(candidate.paraId);
  if (!para || start === undefined || doc.text.slice(start, start + para.text.length) !== para.text) return null;
  return { from: start + candidate.span.start, to: start + candidate.span.end };
}

/**
 * Highlights for the session's state. Null when the session was checked against other text than the
 * view shows (`viewText`: the user typed and a re-check is on its way), so stale offsets never land.
 */
export function highlightRanges(doc: OpenDocument, viewText: string, session: CheckSession): Highlight[] | null {
  if (viewText !== doc.text) return null;
  const starts = new Map<number, number>();
  for (const p of session.paragraphs()) {
    const start = doc.paraStarts.get(p.id);
    if (start === undefined || doc.text.slice(start, start + p.text.length) !== p.text) return null;
    starts.set(p.id, start);
  }
  const { top, more } = session.decisions();
  const decisionKind = new Map<string, Decision['kind']>();
  for (const d of [...top, ...more]) for (const id of d.candidateIds) decisionKind.set(id, d.kind);
  const out: Highlight[] = [];
  for (const o of session.outcomes()) {
    const base = starts.get(o.candidate.paraId)!;
    const from = base + o.candidate.span.start;
    const to = base + o.candidate.span.end;
    const pendingIn = decisionKind.get(o.candidate.id);
    if (o.status === 'applied') out.push({ from, to, kind: o.auto ? 'auto' : 'accepted', replacement: o.replacement });
    else if (pendingIn && to > from) {
      const category = categoryOf(o.candidate, pendingIn);
      out.push({ from, to, kind: 'pending', flag: o.candidate, candidateId: o.candidate.id, category });
    }
  }
  return out;
}
