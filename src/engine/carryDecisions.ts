import type { CheckSession } from './session';
import { UNDONE_BEFORE_REASON } from './sessionTypes';
import type { Source, Span } from './types';

/** One decision the user made on a flag, as a re-check or a resumed review replays it. */
export interface UserDecision {
  candidateId: string;
  paraId: number;
  kind: string;
  original: string;
  span: Span;
  /**
   * Rejected also covers an auto-fix the user undid. Held: an auto-fix the user undid that a later check offered
   * as a card instead (CheckSession.holdBackUndone); it stays a card, never made without a click.
   */
  status: 'applied' | 'rejected' | 'held';
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
 * sentence with that edit in it, so the edit is replayed first (final F14 review M-9). An undone auto-fix held
 * back as a card counts as held. Left out: what else is pending, auto-fixes still applied (the next check makes
 * them again), edits that could not be placed, and flags closed by adding their word to the dictionary (the
 * dictionary itself brings that back).
 */
export function userDecisions(session: CheckSession): UserDecision[] {
  const decisions: UserDecision[] = [];
  for (const o of session.outcomes()) {
    if (o.auto || o.unplaceable !== undefined || o.reason?.endsWith('added to dictionary')) continue;
    const under = o.status === 'superseded' ? session.appliedOver(o.candidate.id) : undefined;
    const held = o.status === 'pending' && o.reason === UNDONE_BEFORE_REASON;
    if (o.status !== 'applied' && o.status !== 'rejected' && under === undefined && !held) continue;
    const { id, paraId, kind, original, span, source } = o.candidate;
    let status: UserDecision['status'] = o.status === 'rejected' ? 'rejected' : 'applied';
    if (held) status = 'held';
    decisions.push({ candidateId: id, paraId, kind, original, span: { ...span }, status, replacement: o.replacement, source, ...(under ? { under } : {}) });
  }
  return decisions;
}

/** How the paragraphs of an earlier check map onto a new one: by position in pairParagraphKeys, by id in its callers. */
export interface ParagraphMatch {
  /** Old → new, for each paragraph whose text did not change and is known to be the same paragraph. */
  unchanged: Map<number, number>;
  /** Old → every new paragraph with its text, for a paragraph left out of `unchanged` because its text is found more than once. */
  copies: Map<number, number[]>;
}

/**
 * Pairs the paragraphs of `before` and `after` by key (their text or its hash). When the list is the same (count,
 * keys and order), each paragraph is itself, copies included: which copy is which is certain (final F15 review
 * M-14). Otherwise only keys found once on each side pair (pairUniqueKeys), and a repeated key gives copies.
 */
export function pairParagraphKeys(before: string[], after: string[]): ParagraphMatch {
  const sameList = before.length === after.length && before.every((key, i) => key === after[i]);
  if (sameList) return { unchanged: new Map(before.map((_, i) => [i, i])), copies: new Map() };
  const unchanged = pairUniqueKeys(before, after);
  return { unchanged, copies: findCopies(before, after, unchanged) };
}

/** Index in `before` → the indexes in `after` with the same key, for each paragraph `unchanged` left out. */
function findCopies(before: string[], after: string[], unchanged: Map<number, number>): Map<number, number[]> {
  const indexesOf = new Map<string, number[]>();
  for (const [j, key] of after.entries()) {
    const indexes = indexesOf.get(key);
    if (indexes) indexes.push(j);
    else indexesOf.set(key, [j]);
  }
  const copies = new Map<number, number[]>();
  for (const [i, key] of before.entries()) {
    const indexes = indexesOf.get(key);
    if (indexes && !unchanged.has(i)) copies.set(i, indexes);
  }
  return copies;
}

/**
 * Index in `before` → index in `after`, for keys found exactly once in each list. A key found more than once on
 * either side is left out: which copy is which can't be told, so no decision is carried onto it and its places
 * come back for review (owner decision, final F14 review I-3, Task F15), undone auto-fixes as cards too.
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
 * auto-fix stays undone (or a card, when it was held). The "real typo" ticks on the names and terms cards are not
 * carried (the card is offered again). Returns old candidate id → its twin's id, for every decision carried (ids
 * follow the paragraph when it moves).
 *
 * A paragraph whose text is found more than once carries nothing, but an auto-fix rejected or held there is held
 * back as a card on every copy (`copies`): which copy it was undone on can't be told, and a change the user undid
 * is never made again without a click (final F15 review M-13).
 */
export function carryDecisions(
  decisions: UserDecision[],
  after: CheckSession,
  unchanged: Map<number, number>,
  copies: Map<number, number[]>,
): Map<string, string> {
  const carried = new Map<string, string>();
  const statusAfter = new Map(after.outcomes().map((o) => [o.candidate.id, o.status]));
  for (const d of decisions) {
    const paraId = unchanged.get(d.paraId);
    if (paraId === undefined) {
      if (d.status === 'applied') continue;
      for (const copy of copies.get(d.paraId) ?? []) {
        const twin = findTwin(after, copy, d);
        if (twin) after.holdBackUndone(twin.id);
      }
      continue;
    }
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
    } else if (d.status === 'held' && now === 'applied') {
      after.holdBackUndone(twin.id);
    }
  }
  return carried;
}
