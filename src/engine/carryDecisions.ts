import type { CheckSession } from './session';
import type { Source, Span } from './types';

/** One decision the user made on a flag, as a re-check or a resumed review replays it. */
export interface UserDecision {
  candidateId: string;
  paraId: number;
  kind: string;
  original: string;
  span: Span;
  /** Rejected also covers an auto-fix the user undid. */
  status: 'applied' | 'rejected';
  /** The replacement chosen, for an applied edit. */
  replacement?: string;
  /** Its index in the candidate's replacements: a saved review keeps this, never the text (-1: not in the list). */
  replacementIndex?: number;
  source: Source;
}

const sameFlag = (a: { kind: string; original: string; span: Span }, b: { kind: string; original: string; span: Span }) =>
  a.kind === b.kind && a.original === b.original && a.span.start === b.span.start && a.span.end === b.span.end;

/**
 * The user's own decisions in `session`: accepted, rejected, and auto-fixes undone. Left out: what is still
 * pending, auto-fixes still applied (the next check makes them again), edits that could not be placed, and
 * flags closed by adding their word to the dictionary (the dictionary itself brings that back).
 */
export function userDecisions(session: CheckSession): UserDecision[] {
  const decisions: UserDecision[] = [];
  for (const o of session.outcomes()) {
    if (o.auto || o.unplaceable !== undefined || (o.status !== 'applied' && o.status !== 'rejected')) continue;
    if (o.reason?.endsWith('added to dictionary')) continue;
    const { id, paraId, kind, original, span, source, replacements } = o.candidate;
    const replacementIndex = o.status === 'applied' ? replacements.indexOf(o.replacement ?? '') : undefined;
    decisions.push({ candidateId: id, paraId, kind, original, span: { ...span }, status: o.status, replacement: o.replacement, replacementIndex, source });
  }
  return decisions;
}

/**
 * Replays `decisions` (from userDecisions of an earlier check, or a saved review) onto `after`, a fresh
 * check, for flags in paragraphs whose text did not change (`unchanged`: the decision's paraId → the new
 * paragraph id). Accepted stays accepted with the same replacement, rejected stays rejected, and an undone
 * auto-fix stays undone. The "real typo" ticks on the names and terms cards are not carried (the card is
 * offered again). Returns old candidate id → its twin's id, for every decision carried (ids follow the
 * paragraph when it moves).
 */
export function carryDecisions(decisions: UserDecision[], after: CheckSession, unchanged: Map<number, number>): Map<string, string> {
  const carried = new Map<string, string>();
  const statusAfter = new Map(after.outcomes().map((o) => [o.candidate.id, o.status]));
  for (const d of decisions) {
    const paraId = unchanged.get(d.paraId);
    if (paraId === undefined) continue;
    const twin = after.candidates().find((c) => c.paraId === paraId && sameFlag(c, d));
    if (!twin) continue;
    carried.set(d.candidateId, twin.id);
    const now = statusAfter.get(twin.id);
    if (d.status === 'applied' && now === 'pending') {
      const index = d.replacement !== undefined ? twin.replacements.indexOf(d.replacement) : (d.replacementIndex ?? -1);
      if (index >= 0) after.accept(twin.id, index);
    } else if (d.status === 'rejected' && now === 'applied') {
      after.undo(twin.id);
    } else if (d.status === 'rejected' && now === 'pending') {
      after.reject(twin.id);
    }
  }
  return carried;
}
