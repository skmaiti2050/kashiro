// Its own file, tests in order: the model is loaded once per test file, and these check the state before that.
import { describe, it, expect } from 'vitest';
import { isRomanisedIndic, loadRomanisedModel } from '@/engine/romanised/classifier';
import { CheckSession } from '@/engine/session';

describe('romanised model loading (lazy, on first use)', () => {
  it('isRomanisedIndic needs the model: it throws before it is loaded', () => {
    expect(() => isRomanisedIndic('accha')).toThrow(/loadRomanisedModel/);
  });

  it('a check loads it when the document has a lowercase unknown word', async () => {
    const s = await CheckSession.start([{ id: 0, text: 'He said chalo, and the food was khub bhalo.' }], {
      preset: 'blog',
      variant: 'American',
      fallbackVariant: 'American',
      language: 'plaintext',
      dictionary: [],
    });
    const { top, more } = s.decisions();
    expect([...top, ...more].some((d) => d.kind === 'otherLanguage')).toBe(true);
    expect(isRomanisedIndic('accha')).toBe(true);
  });

  it('loading again is harmless', async () => {
    await loadRomanisedModel();
    expect(isRomanisedIndic('accha')).toBe(true);
  });
});
