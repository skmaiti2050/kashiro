import { describe, it, expect } from 'vitest';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { decisionTitle, decisionTitleParts, excerpt, wordCardWords } from '@/ui/state/labels';
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

  it('a batch of different repeated words is titled by its kind, in the UI language (review #4, C1)', () => {
    const doubled = (original: string, id: string): Candidate => ({ ...cand(original, [original.split(' ')[0]], id), kind: 'Repetition' });
    const words = byId(doubled('had had', 'a'), doubled('that that', 'b'));
    const batch: Decision = { id: 'batch:repeated-words', kind: 'batch', candidateIds: ['a', 'b'], label: '', score: 3 };
    expect(decisionTitle(en, batch, words)).toBe('Repeated words (2 places)');
    const same = byId(doubled('had had', 'a'), doubled('had had', 'b'));
    expect(decisionTitle(en, batch, same)).toBe('had had → had (2 places)');
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

describe('decisionTitleParts (which parts are the document’s English words)', () => {
  const words = (parts: { text: string; document: boolean }[]) => parts.filter((p) => p.document).map((p) => p.text);

  it('marks only the original and the suggestions as document text', () => {
    const c = cand("can't", ['cannot', 'can not']);
    const batch: Decision = { id: 'batch:x', kind: 'batch', candidateIds: ['c', 'b'], label: '', score: 1 };
    const parts = decisionTitleParts(en, batch, byId(c));
    expect(words(parts)).toEqual(["can't", 'cannot', 'can not']);
    expect(parts.map((p) => p.text).join('')).toBe("can't → cannot / can not (2 places)");
  });

  it('the UI’s own words are not document text: "(delete)", "(empty)", the quote marks, a word card title', () => {
    const deletion = cand('very', ['']);
    expect(words(decisionTitleParts(en, single(deletion), byId(deletion)))).toEqual(['very']);
    const flag = cand('teh', []);
    expect(decisionTitleParts(en, single(flag), byId(flag))).toEqual([
      { text: '“', document: false },
      { text: 'teh', document: true },
      { text: '”', document: false },
    ]);
    const empty = cand('', ['x']);
    expect(decisionTitleParts(en, single(empty), byId(empty))[0]).toEqual({ text: '(empty)', document: false });
    const terms: Decision = { id: 'terms', kind: 'terms', candidateIds: ['a'], label: '', score: 0, counts: { sarpanch: 5 } };
    expect(words(decisionTitleParts(en, terms, byId(cand('sarpanch', [], 'a'))))).toEqual([]);
  });
});

describe('wordCardWords', () => {
  it('names keep their first spelling, once each', () => {
    const names: Decision = { id: 'names', kind: 'names', candidateIds: ['a', 'b', 'c'], label: '', score: 0 };
    expect(wordCardWords(names as never, byId(cand('Priya', [], 'a'), cand('PRIYA', [], 'b'), cand('Nashik', [], 'c')))).toEqual(['Priya', 'Nashik']);
  });
});
