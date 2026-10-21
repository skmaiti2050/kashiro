import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { Translator } from '../i18n/translator';
import { kindLabel } from './kindLabels';

/** Words shown before "…" on a long label (a 42-word sentence flagged for length, say). */
export const EXCERPT_WORDS = 12;

/** The first `words` words of `text` and whether anything was cut ("This sentence is … long" → cut). */
export function excerpt(text: string, words = EXCERPT_WORDS): { text: string; cut: boolean } {
  const parts = text.trim().split(/\s+/);
  if (parts.length <= words) return { text, cut: false };
  return { text: parts.slice(0, words).join(' ') + ' …', cut: true };
}

/** The batch button before its preview: "Apply all 12 fixes (Formatting)". */
export function batchApplyLabel(t: Translator, kind: string, places: number): string {
  return t.t('card.applyAll', { count: places, kind: kindLabel(t, kind) });
}

type WordCard = Decision & { kind: 'names' | 'terms' | 'otherLanguage' };

/** The names, terms and Indian-language cards: a list of words to add, not a change to the text. */
export const isWordCard = (d: Decision): d is WordCard => d.kind === 'names' || d.kind === 'terms' || d.kind === 'otherLanguage';

/**
 * The words a card lists, once each, in order of appearance: terms by their counts, Indian-language words
 * lowercased, names in their first spelling (case-insensitively).
 */
export function wordCardWords(card: WordCard, candidates: Map<string, Candidate>): string[] {
  if (card.kind === 'terms') return Object.keys(card.counts ?? {});
  const originals = card.candidateIds.map((id) => candidates.get(id)!.original);
  if (card.kind === 'otherLanguage') return [...new Set(originals.map((w) => w.toLowerCase()))];
  const firstSpelling = new Map<string, string>();
  for (const word of originals) if (!firstSpelling.has(word.toLowerCase())) firstSpelling.set(word.toLowerCase(), word);
  return [...firstSpelling.values()];
}

const WORD_CARD_TITLES = { names: 'card.namesTitle', terms: 'card.termsTitle', otherLanguage: 'card.otherLanguageTitle' } as const;

/** "3 names and places", "2 terms used in this document", "1 word in an Indian language". */
export function wordCardTitle(t: Translator, card: WordCard, candidates: Map<string, Candidate>): string {
  return t.t(WORD_CARD_TITLES[card.kind], { count: wordCardWords(card, candidates).length });
}

/**
 * A short title for a decision card or "More" row: the (shortened) original and its suggestions, or
 * only the original for a flag with nothing to apply (its message is shown separately).
 */
export function decisionTitle(t: Translator, decision: Decision, candidates: Map<string, Candidate>): string {
  if (isWordCard(decision)) return wordCardTitle(t, decision, candidates);
  const first = candidates.get(decision.candidateIds[0])!;
  const original = excerpt(first.original).text || t.t('card.empty');
  const places = decision.kind === 'batch' ? ` ${t.t('card.places', { count: decision.candidateIds.length })}` : '';
  if (first.replacements.length === 0) return `${t.t('quote', { text: original })}${places}`;
  const fixes = first.replacements.map((r) => (r === '' ? t.t('card.delete') : excerpt(r).text)).join(' / ');
  return `${original} → ${fixes}${places}`;
}
