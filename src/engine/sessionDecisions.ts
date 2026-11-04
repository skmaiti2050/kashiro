import { overlapsLocked } from './factLock';
import { buildDecisions, foldsUnderMore, NAMES_CARD_ID, OTHER_LANGUAGE_CARD_ID, TERMS_CARD_ID, type Decision } from './decisions';
import { untickedByDefault } from './defaultTicks';
import { upFrontCount } from './depth';
import { DEFAULT_MODULES } from './modules';
import type { SessionState } from './sessionState';
import type { Candidate, Span, Tier } from './types';

/** The cards answered by their own method, never by accept: card id → its name and method. */
export const CARD_ACCEPT_METHODS = new Map([
  [NAMES_CARD_ID, { name: 'names and places card', method: 'acceptNames' }],
  [TERMS_CARD_ID, { name: 'terms card', method: 'acceptTerms' }],
  [OTHER_LANGUAGE_CARD_ID, { name: 'words in Indian languages card', method: 'acceptOtherLanguage' }],
]);

/** CheckSession.decisions: see there. */
export function rankDecisions(s: SessionState): { top: Decision[]; more: Decision[] } {
  const pending: Candidate[] = [];
  const tiers = new Map<string, Tier>();
  for (const c of s.cands.values()) {
    if (s.ledger.status.get(c.id) !== 'pending' || s.unplaceable.has(c.id)) continue;
    const t = s.tiers.get(c.id)!;
    if (t === 'hidden') continue;
    pending.push(c);
    // A safe candidate is only pending after an undo/restore: offer it for review.
    tiers.set(c.id, t === 'safe' ? 'review' : t);
  }
  const { decisions, blocked } = buildDecisions(pending, tiers, {
    // Candidates on fact-locked spans (names, numbers, quotes…) are demoted: ranked last, never dropped.
    // Except guarded rewrites: they cover the whole sentence and the guard kept its locked text intact.
    fold: (c) =>
      !s.rewrites.isGuarded(c.id) && foldsUnderMore(c, s.ctx.locked.get(c.paraId), s.paras.get(c.paraId)?.text),
    typoWords: s.typoWords,
    paraText: s.ctx.paraText,
    // Inside an existing tracked change: can't be applied, so never in `top`.
    blocked: (c) => s.ledger.inTrackedChange.has(c.id),
    termMinRepeats: s.termMinRepeats,
    foreignSentences: s.ctx.foreignSentences,
    modules: { ...(s.ctx.modules ?? DEFAULT_MODULES) },
    onCommand: (c) => overlapsLocked(c, s.ctx.commandSpans?.get(c.paraId)),
    untickedOnCard: (fixes) => {
      const unknownWords = spellingFlagSpans(s);
      const commandText = new Map<number, Span[]>();
      return untickedByDefault(fixes, {
        paraText: s.ctx.paraText ?? new Map(),
        optedIn: (c) => s.optedIn.has(c.id),
        commandText: (paraId) => {
          let spans = commandText.get(paraId);
          if (spans === undefined) {
            spans = [...(s.ctx.commandSpans?.get(paraId) ?? []), ...(s.ctx.maybeCommandSpans?.get(paraId) ?? [])];
            commandText.set(paraId, spans);
          }
          return spans;
        },
        unknownWords: (paraId) => unknownWords.get(paraId) ?? [],
      });
    },
  });
  const topSize = upFrontCount(s.reviewDepth, s.words);
  return { top: decisions.slice(0, topSize), more: [...decisions.slice(topSize), ...blocked] };
}

/**
 * paraId → the spans of every spelling flag, whatever its status (a word the user rejected or fixed is still no
 * known word): a line starting with one is never joined to the prose above it (Task F24, clearProse.ts).
 */
function spellingFlagSpans(s: SessionState): Map<number, Span[]> {
  const out = new Map<number, Span[]>();
  for (const c of s.cands.values()) {
    if (c.kind !== 'Spelling') continue;
    const spans = out.get(c.paraId);
    if (spans) spans.push(c.span);
    else out.set(c.paraId, [c.span]);
  }
  return out;
}

/** CheckSession.onWordCard: see there. */
export function isOnWordCard(s: SessionState, candidateId: string): boolean {
  const { top, more } = rankDecisions(s);
  return [...top, ...more].some((d) => CARD_ACCEPT_METHODS.has(d.id) && d.candidateIds.includes(candidateId));
}

/** CheckSession.rankedDecisionCount: see there. */
export function countRankedDecisions(s: SessionState): number {
  const { top, more } = rankDecisions(s);
  // The names card may hold tracked-change names too; it is blocked only when all of it is.
  return top.length + more.filter((d) => !d.candidateIds.every((id) => s.ledger.inTrackedChange.has(id))).length;
}

/**
 * A decision id → its members; a pending candidate's id → that candidate alone, with the decision that
 * holds it as `ownerId`, so accepting one member of a card still meets the card's guard (review #4, C2).
 */
export function resolveDecision(s: SessionState, id: string): { ownerId: string; members: Candidate[] } {
  const { top, more } = rankDecisions(s);
  const all = [...top, ...more];
  const d = all.find((x) => x.id === id);
  if (d) return { ownerId: d.id, members: d.candidateIds.map((m) => s.cands.get(m)!) };
  const c = s.cands.get(id);
  if (c && s.ledger.status.get(c.id) === 'pending') {
    return { ownerId: all.find((x) => x.candidateIds.includes(id))?.id ?? id, members: [c] };
  }
  throw new Error(`unknown or already decided: ${id}`);
}
