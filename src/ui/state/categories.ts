import { SIMPLE_FIXES_ID, type Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { MessageKey } from '../i18n/catalogues';

/**
 * Underline categories (UI/UX research, colour proposal). Each has a colour, an underline style and a
 * glyph, so colour is never the only signal (WCAG 1.4.1). Colours and styles live in app.css as
 * `--cat-<category>` custom properties and `.cat-<category>` classes.
 */
export type Category = 'correctness' | 'clarity' | 'style' | 'terms' | 'ai' | 'names';

export const CATEGORIES: Record<Category, { label: MessageKey; glyph: string }> = {
  correctness: { label: 'category.correctness', glyph: '●' },
  clarity: { label: 'category.clarity', glyph: '◆' },
  style: { label: 'category.style', glyph: '▲' },
  terms: { label: 'category.terms', glyph: '■' },
  ai: { label: 'category.ai', glyph: '✦' },
  names: { label: 'category.names', glyph: 'Aa' },
};

const CLARITY_KINDS = new Set(['Readability', 'Redundancy', 'WordChoice', 'Usage', 'WordOrder', 'Enhancement']);
const STYLE_KINDS = new Set(['Style', 'Variant', 'Contraction', 'Formatting']);

/** The category of a flag, given the kind of decision it is on (a card wins over the flag's own kind). */
export function categoryOf(c: Candidate, decisionKind: Decision['kind']): Category {
  if (c.source === 'llm') return 'ai';
  if (decisionKind === 'names') return 'names';
  if (decisionKind === 'terms' || decisionKind === 'otherLanguage') return 'terms';
  if (CLARITY_KINDS.has(c.kind)) return 'clarity';
  if (STYLE_KINDS.has(c.kind)) return 'style';
  return 'correctness';
}

/** A card's category, as its tag shows it: the simple-fixes card mixes kinds, so it counts as correctness. */
export function categoryOfDecision(d: Decision, candidates: Map<string, Candidate>): Category {
  if (d.id === SIMPLE_FIXES_ID) return 'correctness';
  return categoryOf(candidates.get(d.candidateIds[0])!, d.kind);
}

/** The number of cards in each category that has any, in CATEGORIES order ("Correctness 3 · Clarity 2", F23 item 2). */
export function categoryCounts(decisions: Decision[], candidates: Map<string, Candidate>): Map<Category, number> {
  const counts = new Map<Category, number>();
  for (const d of decisions) {
    const category = categoryOfDecision(d, candidates);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const order = Object.keys(CATEGORIES) as Category[];
  return new Map(order.filter((c) => counts.has(c)).map((c) => [c, counts.get(c)!]));
}
