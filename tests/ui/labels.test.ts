import { describe, it, expect } from 'vitest';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { decisionTitle, excerpt, wordCardWords } from '@/ui/state/labels';
import { createTranslator } from '@/ui/i18n/translator';
import { en } from './english';

const LONG =
  'This sentence keeps going with clause after clause about the monsoon and the market and the people who come every Sunday to buy vegetables, and it never stops for breath at all until the very end of a very long forty-two word run.';

const cand = (original: string, replacements: string[], id = 'c'): Candidate => ({
  id,
  paraId: 0,
  span: { start: 0, end: original.length },
  original,
  replacements,
  kind: 'Readability',
  message: 'This sentence is 42 words long.',
  source: 'rules',
});
const single = (c: Candidate): Decision => ({ id: c.id, kind: 'single', candidateIds: [c.id], label: 'engine label', score: 1 });
const byId = (...cs: Candidate[]) => new Map(cs.map((c) => [c.id, c]));

describe('excerpt', () => {
  it('keeps short text whole', () => {
    expect(excerpt('teh cat')).toEqual({ text: 'teh cat', cut: false });
  });

  it('cuts long text after 12 words', () => {
    expect(excerpt(LONG)).toEqual({ text: 'This sentence keeps going with clause after clause about the monsoon and …', cut: true });
  });
});

describe('decisionTitle', () => {
  it('a flag with nothing to apply shows only the (shortened) original, never the message', () => {
    const c = cand(LONG, []);
    expect(decisionTitle(en, single(c), byId(c))).toBe('“This sentence keeps going with clause after clause about the monsoon and …”');
  });

  it('a fix shows original → suggestions, with the places of a batch', () => {
    const c = cand("can't", ['cannot']);
    expect(decisionTitle(en, single(c), byId(c))).toBe("can't → cannot");
    const batch: Decision = { id: 'batch:x', kind: 'batch', candidateIds: ['c', 'b'], label: '', score: 1 };
    expect(decisionTitle(en, batch, byId(c))).toBe("can't → cannot (2 places)");
    const deletion = cand('very', ['']);
    expect(decisionTitle(en, single(deletion), byId(deletion))).toBe('very → (delete)');
  });

  it('the word cards show their count in words, in the UI language', () => {
    const terms: Decision = { id: 'terms', kind: 'terms', candidateIds: ['a'], label: 'engine label', score: 0, counts: { sarpanch: 5, gram: 3 } };
    expect(decisionTitle(en, terms, byId(cand('sarpanch', [], 'a')))).toBe('2 terms used in this document');
    const words = byId(cand('Chalo', [], 'a'), cand('chalo', [], 'b'), cand('accha', [], 'c'));
    const otherLanguage: Decision = { id: 'other-language', kind: 'otherLanguage', candidateIds: ['a', 'b', 'c'], label: '', score: 0 };
    expect(decisionTitle(en, otherLanguage, words)).toBe('2 words in Indian languages');
    const hi = createTranslator('hi', ['hi-IN']);
    expect(decisionTitle(hi, otherLanguage, words)).toBe('भारतीय भाषाओं के 2 शब्द');
  });
});

describe('wordCardWords', () => {
  it('names keep their first spelling, once each', () => {
    const names: Decision = { id: 'names', kind: 'names', candidateIds: ['a', 'b', 'c'], label: '', score: 0 };
    expect(wordCardWords(names as never, byId(cand('Priya', [], 'a'), cand('PRIYA', [], 'b'), cand('Nashik', [], 'c')))).toEqual(['Priya', 'Nashik']);
  });
});
