import { describe, it, expect, beforeAll, vi } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { isRomanisedIndic, loadRomanisedModel, unloadRomanisedModel } from '@/engine/romanised/classifier';

// Wraps the real loader in a spy: a check with the other-languages card off must never call it.
vi.mock('@/engine/romanised/classifier', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/engine/romanised/classifier')>();
  return { ...real, loadRomanisedModel: vi.fn(real.loadRomanisedModel) };
});

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

const ROMANISED = 'It was khub bhalo laglo, ebong kichu cheap. I got teh letter.';
const check = (otherLanguageCard: boolean) =>
  CheckSession.start(
    [{ id: 0, text: ROMANISED }],
    { preset: 'business', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [], modules: { otherLanguageCard } },
    { linter },
  );

describe('the romanised model loads only when the other-languages card is on', () => {
  it('a check with the card off never calls the loader, and its decisions need no model', async () => {
    const s = await check(false);
    s.decisions();
    expect(loadRomanisedModel).not.toHaveBeenCalled();
    // Proof the model really is absent: a word the classifier never judged can't be judged.
    expect(() => isRomanisedIndic('jayenge')).toThrow(/not loaded/);
  });

  it('a check with the card on loads it; unloading drops it until the next check that needs it', async () => {
    await check(true);
    expect(loadRomanisedModel).toHaveBeenCalledTimes(1);
    expect(isRomanisedIndic('khub')).toBe(true);
    unloadRomanisedModel();
    expect(() => isRomanisedIndic('jayenge')).toThrow(/not loaded/);
    const s = await check(true);
    expect(s.decisions().top.concat(s.decisions().more).some((d) => d.kind === 'otherLanguage')).toBe(true);
    expect(isRomanisedIndic('jayenge')).toBe(true);
  });
});
