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
  /** The replacement chosen, for an applied edit: replayed only if the new check suggests this same text. */
  replacement?: string;
  source: Source;
  /** An accepted edit that an AI rewrite (this id) superseded: carrying the rewrite supersedes it again. */
  under?: string;
}

type Flag = Pick<UserDecision, 'kind' | 'original' | 'span'>;

const sameFlag = (a: Flag, b: Flag) => a.kind === b.kind && a.original === b.original && a.span.start === b.span.start && a.span.end === b.span.end;

/** The candidate of `session` in paragraph `paraId` that flags the same text, the same way, as `flag`. */
export const findTwin = (session: CheckSession, paraId: number, flag: Flag) =>
  session.candidates().find((c) => c.paraId === paraId && sameFlag(c, flag));

/**
 * The user's own decisions in `session`: accepted, rejected, and auto-fixes undone. An edit the user accepted and
 * then an AI rewrite of its sentence superseded counts as accepted, with `under` set: the rewrite was made for the
 * sentence with that edit in it, so the edit is replayed first (final F14 review M-9). Left out: what is still
 * pending, auto-fixes still applied (the next check makes them again), edits that could not be placed, and flags
 * closed by adding their word to the dictionary (the dictionary itself brings that back).
 */
export function userDecisions(session: CheckSession): UserDecision[] {
  const decisions: UserDecision[] = [];
  for (const o of session.outcomes()) {
    if (o.auto || o.unplaceable !== undefined || o.reason?.endsWith('added to dictionary')) continue;
    const under = o.status === 'superseded' ? session.appliedOver(o.candidate.id) : undefined;
    if (o.status !== 'applied' && o.status !== 'rejected' && under === undefined) continue;
    const { id, paraId, kind, original, span, source } = o.candidate;
    const status = o.status === 'rejected' ? 'rejected' : 'applied';
    decisions.push({ candidateId: id, paraId, kind, original, span: { ...span }, status, replacement: o.replacement, source, ...(under ? { under } : {}) });
  }
  return decisions;
}

/**
 * Index in `before` → index in `after`, for the paragraphs whose key (text or its hash) did not change. When the
 * list is the same (count, keys and order), each paragraph is itself, copies included: which copy is which is
 * certain (final F15 review M-14). Otherwise see pairUniqueKeys.
 */
export function pairUnchangedKeys(before: string[], after: string[]): Map<number, number> {
  const sameList = before.length === after.length && before.every((key, i) => key === after[i]);
  return sameList ? new Map(before.map((_, i) => [i, i])) : pairUniqueKeys(before, after);
}

/**
 * Index in `before` → index in `after`, for keys found exactly once in each list. A key found more than once on
 * either side is left out: which copy is which can't be told, so no decision is carried onto it and its places
 * come back for review (owner decision, final F14 review I-3, Task F15).
 */
function pairUniqueKeys(before: string[], after: string[]): Map<number, number> {
  const onlyOnce = (keys: string[]) => {
    const at = new Map<string, number>();
    const repeated = new Set<string>();
    for (const [i, key] of keys.entries()) {
      if (at.has(key)) repeated.add(key);
      else at.set(key, i);
    }
    for (const key of repeated) at.delete(key);
    return at;
  };
  const beforeAt = onlyOnce(before);
  const pairs = new Map<number, number>();
  for (const [key, j] of onlyOnce(after)) {
    const i = beforeAt.get(key);
    if (i !== undefined) pairs.set(i, j);
  }
  return pairs;
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
    const twin = findTwin(after, paraId, d);
    if (!twin) continue;
    carried.set(d.candidateId, twin.id);
    const now = statusAfter.get(twin.id);
    if (d.status === 'applied' && now === 'pending') {
      // A word now on the names, terms or Indian-language card is answered there again, never replaced by accept.
      if (after.onWordCard(twin.id)) continue;
      // By text, never by position: the same index may hold another word now, one the user never chose.
      const index = twin.replacements.indexOf(d.replacement ?? '');
      if (index >= 0) after.accept(twin.id, index);
    } else if (d.status === 'rejected' && now === 'applied') {
      after.undo(twin.id);
    } else if (d.status === 'rejected' && now === 'pending') {
      after.reject(twin.id);
    }
  }
  return carried;
}
