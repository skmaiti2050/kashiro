import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';

/** Words shown before "…" on a long label (a 42-word sentence flagged for length, say). */
export const EXCERPT_WORDS = 12;

/** The first `words` words of `text` and whether anything was cut ("This sentence is … long" → cut). */
export function excerpt(text: string, words = EXCERPT_WORDS): { text: string; cut: boolean } {
  const parts = text.trim().split(/\s+/);
  if (parts.length <= words) return { text, cut: false };
  return { text: parts.slice(0, words).join(' ') + ' …', cut: true };
}

/**
 * A short title for a decision card or "More" row: the (shortened) original and its suggestions, or
 * only the original for a flag with nothing to apply (its message is shown separately).
 */
export function decisionTitle(decision: Decision, first: Candidate): string {
  if (decision.kind === 'names' || decision.kind === 'terms' || decision.kind === 'otherLanguage') return decision.label;
  const original = excerpt(first.original).text || '(empty)';
  const places = decision.kind === 'batch' ? ` (${decision.candidateIds.length} places)` : '';
  if (first.replacements.length === 0) return `“${original}”${places}`;
  const fixes = first.replacements.map((r) => (r === '' ? '(delete)' : excerpt(r).text)).join(' / ');
  return `${original} → ${fixes}${places}`;
}
