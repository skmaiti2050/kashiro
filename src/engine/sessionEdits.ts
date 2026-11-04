import { SIMPLE_FIXES_ID } from './decisions';
import { doubledWord } from './wordFlags';
import { holdBack } from './sessionIntake';
import { CARD_ACCEPT_METHODS, decisionMembers, resolveDecision } from './sessionDecisions';
import { TRACKED_CHANGE_REASON, UNDONE_BEFORE_REASON } from './sessionTypes';
import type { SessionState } from './sessionState';
import type { Candidate } from './types';

const RESTORED_INVISIBLE_REASON = 'it would delete an invisible character you restored';

/**
 * The one place accept and applyBatch apply edits, so both keep the card guard and the same-text check.
 * `decisionId` is the decision that owns the members (resolve), never one member's own id.
 */
export function applyMembers(s: SessionState, decisionId: string, members: Candidate[], replacementIndex: number): void {
  // Replacing names or terms with dictionary words by index would damage them (spec §5).
  const card = CARD_ACCEPT_METHODS.get(decisionId);
  if (card) throw new Error(`the ${card.name} is answered with ${card.method}(keepAsTypos), not accept`);
  for (const c of members) {
    if (c.replacements[replacementIndex] === undefined) {
      throw new Error(`candidate ${c.id} has no replacement at index ${replacementIndex}`);
    }
  }
  const texts = new Set(members.map((c) => c.replacements[replacementIndex].toLowerCase()));
  // Doubled words share one fix, keeping the first copy, whatever the word ("had had", "the the"); the
  // simple-fixes card lists each place with its own one fix.
  const allDoubled = members.every((c) => doubledWord(c) !== null);
  if (texts.size > 1 && !allDoubled && decisionId !== SIMPLE_FIXES_ID) {
    throw new Error(
      `${decisionId}: members have different replacements at index ${replacementIndex} (${[...texts].join(' / ')}); accept them one by one`,
    );
  }
  for (const c of members) {
    if (s.ledger.inTrackedChange.has(c.id)) {
      s.ledger.record(c.id, 'pending', false, TRACKED_CHANGE_REASON);
      continue;
    }
    // Never over an edit the user applied, one made a moment ago in this batch included: withdrawCovered takes it out.
    if (c.source !== 'llm' && s.ledger.userEditOver(c)) continue;
    if (coversRestoredInvisible(s, c)) {
      markUnplaceable(s, c.id, RESTORED_INVISIBLE_REASON);
      continue;
    }
    s.ledger.apply(c, c.replacements[replacementIndex], false);
  }
  withdrawOutdated(s);
}

/** The next "Apply all" group id: used by applyBatch and by the AI rewrites' accept-all. */
export function newBatchId(s: SessionState): string {
  return `batch-${++s.batchCount}`;
}

/** CheckSession.applyBatch: see there. */
export function applyBatch(s: SessionState, decisionId: string, candidateIds: string[] | undefined, replacementIndex: number): string {
  const { ownerId, members } = resolveDecision(s, decisionId);
  const chosen = (candidateIds ?? members.map((c) => c.id)).map((id) => {
    const member = members.find((c) => c.id === id);
    if (!member) throw new Error(`${id} is not part of ${decisionId}`);
    return member;
  });
  if (chosen.length === 0) throw new Error(`choose at least one place of ${decisionId} to apply`);
  applyMembers(s, ownerId, chosen, replacementIndex);
  const batchId = newBatchId(s);
  for (const c of chosen) if (s.ledger.status.get(c.id) === 'applied') s.batchOf.set(c.id, batchId);
  return batchId;
}

/** CheckSession.undoBatch: see there. */
export function undoBatch(s: SessionState, batchId: string): void {
  const ids = [...s.batchOf].filter(([, b]) => b === batchId).map(([id]) => id);
  if (ids.length === 0) throw new Error(`unknown batch ${batchId}`);
  for (const id of ids) {
    s.batchOf.delete(id);
    if (s.ledger.status.get(id) === 'applied') undo(s, id);
  }
}

/**
 * After the text changed: a rule fix inside an edit the user applied leaves the review (and one no longer covered
 * comes back), and so does a pending AI rewrite of a sentence that now reads differently.
 */
function withdrawOutdated(s: SessionState): void {
  s.ledger.withdrawCovered();
  s.rewrites.withdrawStale();
}

/**
 * A fix's replacement was made on text without invisible characters, so over one the user kept (undid or
 * declined its removal) it would delete that character again (#9). Known only after setup, so checked on accept.
 */
function coversRestoredInvisible(s: SessionState, c: Candidate): boolean {
  if (c.kind === 'Invisible') return false;
  return [...s.userRejected].some((id) => {
    const o = s.cands.get(id);
    return o?.kind === 'Invisible' && o.paraId === c.paraId && c.span.start <= o.span.start && o.span.end <= c.span.end;
  });
}

/** CheckSession.reject: see there. */
export function rejectDecision(s: SessionState, decisionId: string): void {
  for (const c of decisionMembers(s, decisionId)) {
    s.userRejected.add(c.id);
    s.ledger.record(c.id, 'rejected', false);
  }
}

/** CheckSession.undo: see there. */
export function undo(s: SessionState, candidateId: string): void {
  const status = s.ledger.status.get(candidateId);
  if (status === 'applied') {
    s.batchOf.delete(candidateId);
    s.ledger.autoApplied.delete(candidateId);
    s.userRejected.add(candidateId);
    s.ledger.record(candidateId, 'rejected', false, 'undone');
    s.ledger.restoreSuperseded(candidateId);
  } else if (status === 'rejected' && s.userRejected.has(candidateId)) {
    s.userRejected.delete(candidateId);
    s.ledger.record(candidateId, 'pending', false);
  } else {
    throw new Error(`cannot undo ${candidateId} (${status ?? 'unknown'})`);
  }
  // Either way the text, or a rewrite back in review, may no longer match what a pending fix was made for.
  withdrawOutdated(s);
}

/** CheckSession.holdBackUndone: see there. */
export function holdBackUndone(s: SessionState, candidateId: string): void {
  if (s.ledger.status.get(candidateId) !== 'applied' || !s.ledger.autoApplied.has(candidateId)) return;
  holdBack(s, candidateId, UNDONE_BEFORE_REASON);
  withdrawOutdated(s);
}

/** CheckSession.markUnplaceable: see there. */
export function markUnplaceable(s: SessionState, candidateId: string, reason: string): void {
  if (!s.cands.has(candidateId)) throw new Error(`unknown candidate ${candidateId}`);
  s.unplaceable.set(candidateId, reason);
  s.ledger.record(candidateId, 'rejected', s.ledger.autoApplied.has(candidateId), `unplaceable: ${reason}`);
  s.ledger.restoreSuperseded(candidateId);
  withdrawOutdated(s);
}
