import type { CheckSession } from '@/engine/session';
import type { Candidate } from '@/engine/types';

const sameFlag = (a: Candidate, b: Candidate) =>
  a.kind === b.kind && a.original === b.original && a.span.start === b.span.start && a.span.end === b.span.end;

/**
 * Replays the user's own decisions from `before` onto `after` (a fresh check of edited text), for
 * candidates in paragraphs whose text did not change (`unchanged`: old paragraph id → new id).
 * Accepted stays accepted with the same replacement, rejected stays rejected, and an undone auto-fix
 * stays undone. Words added to the dictionary come back through the dictionary itself, and the
 * names-card "real typo" ticks are not carried (the card is offered again).
 */
export function carryDecisions(before: CheckSession, after: CheckSession, unchanged: Map<number, number>): void {
  const statusAfter = new Map(after.outcomes().map((o) => [o.candidate.id, o.status]));
  for (const o of before.outcomes()) {
    if (o.auto || o.unplaceable !== undefined || o.status === 'pending' || o.status === 'superseded') continue;
    if (o.reason?.endsWith('added to dictionary')) continue;
    const paraId = unchanged.get(o.candidate.paraId);
    if (paraId === undefined) continue;
    const twin = after.candidates().find((c) => c.paraId === paraId && sameFlag(c, o.candidate));
    if (!twin) continue;
    const now = statusAfter.get(twin.id);
    if (o.status === 'applied' && now === 'pending') {
      const index = twin.replacements.indexOf(o.replacement ?? '');
      if (index >= 0) after.accept(twin.id, index);
    } else if (o.status === 'rejected' && now === 'applied') {
      after.undo(twin.id);
    } else if (o.status === 'rejected' && now === 'pending') {
      after.reject(twin.id);
    }
  }
}
