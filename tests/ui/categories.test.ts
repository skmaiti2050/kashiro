// Underline category per flag (U1 item 3) and the batch button wording (item 5).
import { describe, it, expect } from 'vitest';
import type { Candidate } from '@/engine/types';
import { CATEGORIES, categoryOf } from '@/ui/state/categories';
import { batchApplyLabel, fixesLabel } from '@/ui/state/labels';

const cand = (kind: string, source: Candidate['source'] = 'rules'): Candidate => ({
  id: kind,
  paraId: 0,
  span: { start: 0, end: 3 },
  original: 'abc',
  replacements: ['abd'],
  kind,
  message: '',
  source,
});

describe('categoryOf', () => {
  it('sorts rules flags into correctness, clarity and style', () => {
    const kinds = ['Spelling', 'Grammar', 'Punctuation', 'Readability', 'Redundancy', 'WordChoice', 'Style', 'Contraction', 'Variant'];
    expect(kinds.map((k) => categoryOf(cand(k), 'single'))).toEqual([
      'correctness',
      'correctness',
      'correctness',
      'clarity',
      'clarity',
      'clarity',
      'style',
      'style',
      'style',
    ]);
  });

  it('the cards win over the kind; LLM rewrites are their own category', () => {
    expect(categoryOf(cand('Spelling'), 'names')).toBe('names');
    expect(categoryOf(cand('Spelling'), 'terms')).toBe('terms');
    expect(categoryOf(cand('Spelling'), 'otherLanguage')).toBe('terms');
    expect(categoryOf(cand('Rewrite', 'llm'), 'single')).toBe('ai');
  });

  it('every category has its own glyph and underline style, so colour is never the only signal', () => {
    const all = Object.values(CATEGORIES);
    expect(new Set(all.map((c) => c.glyph)).size).toBe(all.length);
    expect(all.every((c) => c.label.length > 0)).toBe(true);
  });
});

describe('batchApplyLabel', () => {
  it('states the count and the kind', () => {
    expect(batchApplyLabel('Formatting', 12)).toBe('Apply all 12 formatting fixes');
    expect(batchApplyLabel('BoundaryError', 2)).toBe('Apply all 2 word-joining fixes');
    expect(batchApplyLabel('Contraction', 3)).toBe('Apply all 3 contraction fixes');
    expect(batchApplyLabel('SomethingNew', 2)).toBe('Apply all 2 somethingnew fixes');
  });

  it('the change log names a batch the same way', () => {
    expect(fixesLabel('Repetition', 1)).toBe('1 repeated-word fix');
    expect(fixesLabel('Spelling', 3)).toBe('3 spelling fixes');
  });
});
