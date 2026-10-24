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
  return decisionTitleParts(t, decision, candidates)
    .map((part) => part.text)
    .join('');
}

/** A piece of a title: the document's own (English) words, or the UI's. */
export interface TitlePart {
  text: string;
  document: boolean;
}

/** Marks the quote's value, to split “{text}” around it in any language. */
const VALUE_MARK = '\u0000';

/** decisionTitle in parts, so the document's words can be marked lang="en" and nothing else. */
export function decisionTitleParts(t: Translator, decision: Decision, candidates: Map<string, Candidate>): TitlePart[] {
  const ui = (text: string): TitlePart => ({ text, document: false });
  const doc = (text: string): TitlePart => ({ text, document: true });
  if (isWordCard(decision)) return [ui(wordCardTitle(t, decision, candidates))];
  const first = candidates.get(decision.candidateIds[0])!;
  const places = decision.kind === 'batch' ? [ui(` ${t.t('card.places', { count: decision.candidateIds.length })}`)] : [];
  // A batch of different doubled words ("had had", "the the"): its kind names it, each place shows its own fix.
  if (decision.kind === 'batch' && first.kind === 'Repetition') {
    const originals = new Set(decision.candidateIds.map((id) => candidates.get(id)!.original.toLowerCase()));
    if (originals.size > 1) return [ui(kindLabel(t, first.kind)), ...places];
  }
  const originalText = excerpt(first.original).text;
  const original = originalText ? doc(originalText) : ui(t.t('card.empty'));
  if (first.replacements.length === 0) {
    const [before, after] = t.t('quote', { text: VALUE_MARK }).split(VALUE_MARK);
    return [ui(before), original, ui(after), ...places].filter((part) => part.text !== '');
  }
  const fixes = first.replacements.flatMap((r, i) => [...(i > 0 ? [ui(' / ')] : []), r === '' ? ui(t.t('card.delete')) : doc(excerpt(r).text)]);
  return [original, ui(' → '), ...fixes, ...places];
}
