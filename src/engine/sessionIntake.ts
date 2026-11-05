import { isZeroClickChange } from './zeroClick';
import { editsChangingTokens } from './tokenGuard';
import { tierOf } from './tiers';
import { splitsCharacter, SPLITS_CHARACTER_REASON } from './graphemes';
import { byPosition, overlaps, TRACKED_CHANGE_REASON } from './sessionTypes';
import type { SessionState } from './sessionState';
import type { Candidate, Tier } from './types';

/** Why a change made without a click was taken back by the token check (holdBackChangedTokens). */
const HELD_BACK_REASON = 'held back: it would change a word';

/** CheckSession.addCandidates: see there. */
export function addCandidates(s: SessionState, cs: Candidate[]): void {
  for (const c of cs) {
    if (s.cands.has(c.id)) continue;
    s.cands.set(c.id, c);
    s.tiers.set(c.id, sessionTier(s, c));
    s.ledger.status.set(c.id, 'pending');
    const adapterLocked = s.paras.get(c.paraId)?.locked;
    if (adapterLocked?.some((locked) => overlaps(c.span, locked))) {
      s.ledger.inTrackedChange.add(c.id);
      s.ledger.reasons.set(c.id, TRACKED_CHANGE_REASON);
      if (s.tiers.get(c.id) !== 'hidden') s.tiers.set(c.id, 'review');
    }
    // A hidden flag is applied only when accepted directly, and applyMembers checks it then: it stays hidden.
    if (s.tiers.get(c.id) !== 'hidden' && refuseCharacterSplit(s, c)) s.tiers.set(c.id, 'review');
  }
  s.ledger.withdrawCovered(); // one added inside an edit the user applied is never offered
}

/**
 * Never damage: half a syllable or emoji can't be written back, so a candidate whose span cuts inside a character
 * is recorded unplaceable (and true returned). Hygiene is exempt: it already keeps meaningful joiners itself.
 * Checked when candidates arrive (addCandidates) and again when edits are applied (applyMembers).
 */
export function refuseCharacterSplit(s: SessionState, c: Candidate): boolean {
  if (c.source === 'hygiene' || !splitsCharacter(paragraphText(s, c.paraId), c.span)) return false;
  s.unplaceable.set(c.id, SPLITS_CHARACTER_REASON);
  s.ledger.record(c.id, 'rejected', false, `unplaceable: ${SPLITS_CHARACTER_REASON}`);
  return true;
}

function paragraphText(s: SessionState, paraId: number): string {
  const p = s.paras.get(paraId);
  if (!p) throw new Error(`unknown paragraph ${paraId}`);
  return p.text;
}

/**
 * tierOf, with its 'safe' split in two (owner decision, Task F4): only a zero-click change (isZeroClickChange:
 * an invisible character, or spaces between words) stays 'safe' and is applied without a click; any other safe
 * fix is 'batch', for the simple-fixes card. No setting changes this split.
 */
function sessionTier(s: SessionState, c: Candidate): Tier {
  const tier = tierOf(c, s.ctx);
  if (tier !== 'safe') return tier;
  // An engine not trusted with no-click fixes: its safe fixes wait on the card.
  if (s.ctx.paragraphEngines?.get(c.paraId)?.trust.zeroClick === false) return 'batch';
  const p = s.paras.get(c.paraId)!;
  // Maybe-command text is never changed without a click either (Task F21c, review M-24).
  const untouched = [...(s.ctx.locked.get(c.paraId) ?? []), ...(s.ctx.maybeCommandSpans?.get(c.paraId) ?? [])];
  if (isZeroClickChange(c, p, untouched, s.alignedParas.has(c.paraId))) return 'safe';
  // Safe only because the user added its kind in Settings: on the card, but never ticked (owner, 2026-10-25).
  if (s.ctx.userTierOverrides && tierOf(c, { ...s.ctx, userTierOverrides: undefined }) !== 'safe') s.optedIn.add(c.id);
  return 'batch';
}

export function autoApply(s: SessionState): void {
  const safe = [...s.cands.values()].filter((c) => s.tiers.get(c.id) === 'safe').sort(byPosition);
  for (const c of safe) {
    if (s.ledger.clashing(c).length) {
      s.tiers.set(c.id, 'review');
      continue;
    }
    s.ledger.apply(c, c.replacements[0], true);
  }
}

/**
 * The backstop after autoApply (Task F4), independent of the tiers: in each paragraph, a change made without a
 * click that alters a token (keepsTokens) is taken back and offered for review instead.
 */
export function holdBackChangedTokens(s: SessionState): void {
  for (const [paraId, p] of s.paras) {
    const auto = [...s.ledger.autoApplied].map((id) => s.cands.get(id)!).filter((c) => c.paraId === paraId);
    if (auto.length === 0) continue;
    const edits = auto.map((c) => ({ paraId, span: c.span, replacement: s.ledger.replacement.get(c.id)! }));
    for (const i of editsChangingTokens(p.text, edits, hygieneRemovable(s, paraId))) holdBack(s, auto[i].id, HELD_BACK_REASON);
  }
}

/** A change made without a click goes back to pending, offered for review. */
export function holdBack(s: SessionState, candidateId: string, reason: string): void {
  s.ledger.autoApplied.delete(candidateId);
  s.ledger.record(candidateId, 'pending', false, reason);
  s.tiers.set(candidateId, 'review');
}

/** Offsets in the paragraph of the invisible characters hygiene flagged with a deletion: all the backstop lets go. */
function hygieneRemovable(s: SessionState, paraId: number): Set<number> {
  const flagged = [...s.cands.values()].filter((c) => c.paraId === paraId && c.source === 'hygiene' && c.replacements[0] === '');
  return new Set(flagged.map((c) => c.span.start));
}
