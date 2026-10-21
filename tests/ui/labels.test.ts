import { describe, it, expect } from 'vitest';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { decisionTitle, excerpt } from '@/ui/state/labels';

const LONG =
  'This sentence keeps going with clause after clause about the monsoon and the market and the people who come every Sunday to buy vegetables, and it never stops for breath at all until the very end of a very long forty-two word run.';

const cand = (original: string, replacements: string[]): Candidate => ({
  id: 'c',
  paraId: 0,
  span: { start: 0, end: original.length },
  original,
  replacements,
  kind: 'Readability',
  message: 'This sentence is 42 words long.',
  source: 'rules',
});
const single = (c: Candidate): Decision => ({ id: c.id, kind: 'single', candidateIds: [c.id], label: 'engine label', score: 1 });

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
    const title = decisionTitle(single(cand(LONG, [])), cand(LONG, []));
    expect(title).toBe('“This sentence keeps going with clause after clause about the monsoon and …”');
  });

  it('a fix shows original → suggestions, with the places of a batch', () => {
    const c = cand("can't", ['cannot']);
    expect(decisionTitle(single(c), c)).toBe("can't → cannot");
    const batch: Decision = { id: 'batch:x', kind: 'batch', candidateIds: ['a', 'b'], label: '', score: 1 };
    expect(decisionTitle(batch, c)).toBe("can't → cannot (2 places)");
    expect(decisionTitle(single(cand('very', [''])), cand('very', ['']))).toBe('very → (delete)');
  });

  it('the names and terms cards show their own label', () => {
    const c = cand('dosha', ['dosa']);
    const terms: Decision = { id: 'terms', kind: 'terms', candidateIds: ['a'], label: '2 terms used in this document', score: 0 };
    expect(decisionTitle(terms, c)).toBe('2 terms used in this document');
    const otherLanguage: Decision = { id: 'other-language', kind: 'otherLanguage', candidateIds: ['a'], label: '2 words in Indian languages', score: 0 };
    expect(decisionTitle(otherLanguage, c)).toBe('2 words in Indian languages');
  });
});
