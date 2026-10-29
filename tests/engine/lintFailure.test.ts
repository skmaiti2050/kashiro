import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { Paragraph } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const OPTIONS: CheckOptions = { preset: 'business', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] };

/** The real linter, except that it throws (as Harper does when it panics) on any batch holding "BOOM". */
const throwingOn = (marker: string): RulesLinter => {
  const fail = (paras: Paragraph[]) => {
    if (paras.some((p) => p.text.includes(marker))) throw new Error('RuntimeError: unreachable');
  };
  return {
    get variant() {
      return linter.variant;
    },
    lintParagraphs: async (paras, language) => {
      fail(paras);
      return linter.lintParagraphs(paras, language);
    },
    lintSpelling: async (paras, variant) => {
      fail(paras);
      return linter.lintSpelling(paras, variant);
    },
    addWords: (w) => linter.addWords(w),
    setVariant: (v) => linter.setVariant(v),
  };
};

const PARAS: Paragraph[] = [
  { id: 0, text: 'The first paragrph is fine.' },
  { id: 1, text: 'BOOM goes the secnd one.' },
  { id: 2, text: 'The third paragrph is fine too.' },
];

describe('a paragraph Harper throws on (Task F21d, review I-4)', () => {
  it.each([
    ['in one batch', undefined],
    ['a chunk at a time', async () => {}],
  ])('is reported as unchecked and the rest is checked (%s)', async (_name, pause) => {
    const s = await CheckSession.start(PARAS, OPTIONS, { linter: throwingOn('BOOM'), pause });
    expect(s.uncheckedParagraphs()).toEqual([1]);
    expect(s.candidates().map((c) => [c.paraId, c.original])).toEqual(
      expect.arrayContaining([
        [0, 'paragrph'],
        [2, 'paragrph'],
      ]),
    );
    expect(s.candidates().filter((c) => c.paraId === 1 && c.source === 'rules')).toEqual([]);
    expect(s.outputText(1)).toBe(PARAS[1].text);
  });

  it('a check with no failure has no unchecked paragraph', async () => {
    const s = await CheckSession.start(PARAS, OPTIONS, { linter });
    expect(s.uncheckedParagraphs()).toEqual([]);
  });
});
