import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';

/**
 * Underline categories (UI/UX research, colour proposal). Each has a colour, an underline style and a
 * glyph, so colour is never the only signal (WCAG 1.4.1). Colours and styles live in app.css as
 * `--cat-<category>` custom properties and `.cat-<category>` classes.
 */
export type Category = 'correctness' | 'clarity' | 'style' | 'terms' | 'ai' | 'names';

export const CATEGORIES: Record<Category, { label: string; glyph: string }> = {
  correctness: { label: 'Correctness', glyph: '●' },
  clarity: { label: 'Clarity', glyph: '◆' },
  style: { label: 'Style', glyph: '▲' },
  terms: { label: 'Terms', glyph: '■' },
  ai: { label: 'AI rewrite', glyph: '✦' },
  names: { label: 'Names and places', glyph: 'Aa' },
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
