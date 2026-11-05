/**
 * The words-in-Indian-languages card judges English paragraphs' flags only: the romanised model is English's, and a
 * document English checks nothing in never loads it. This file never loads the model, so a flag from another engine
 * reaching the card would throw.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { OTHER_LANGUAGE_CARD_ID } from '@/engine/decisions';
import { isRomanisedIndic } from '@/engine/romanised/classifier';
import type { CheckOptions } from '@/engine/sessionTypes';
import type { Candidate } from '@/engine/types';
import { devanagariEngines, fakeEngine } from '../fixtures/fakeEngines';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts: CheckOptions = { preset: 'business', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] };

const HINDI = 'यह एक परीक्षण है।';

describe('a Latin word flagged in a Hindi paragraph', () => {
  it('is a review decision, not on the other-language card, and ranking does not need the romanised model', async () => {
    const text = 'यह बहुत अच्छा और khub अच्छा है।';
    const start = text.indexOf('khub');
    const khub: Candidate = {
      id: `0:${start}:${start + 4}:Spelling`,
      paraId: 0,
      span: { start, end: start + 4 },
      original: 'khub',
      replacements: ['khoob'],
      kind: 'Spelling',
      message: 'fake',
      source: 'rules',
    };
    const paras = [text, HINDI, HINDI].map((t, id) => ({ id, text: t }));
    const s = await CheckSession.start(paras, opts, { linter, scriptEngines: devanagariEngines(fakeEngine({ found: [khub] })) });
    expect(s.engineOf(0)?.id).toBe('fake-hi');
    expect(s.tier(khub.id)).toBe('review');

    const { top, more } = s.decisions();
    const all = [...top, ...more];
    expect(all.find((d) => d.id === OTHER_LANGUAGE_CARD_ID)).toBeUndefined();
    expect(all.some((d) => d.candidateIds.includes(khub.id))).toBe(true);
    expect(s.rankedDecisionCount()).toBe(1);
    // The test holds only while nothing loaded the model.
    expect(() => isRomanisedIndic('accha')).toThrow(/not loaded/);
  });
});
