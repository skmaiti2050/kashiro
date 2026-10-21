import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { loadRomanisedModel } from '@/engine/romanised/classifier';

// Wraps the real loader in a spy, to see when a check loads the romanised model.
vi.mock('@/engine/romanised/classifier', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/engine/romanised/classifier')>();
  return { ...real, loadRomanisedModel: vi.fn(real.loadRomanisedModel) };
});

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});
beforeEach(() => vi.mocked(loadRomanisedModel).mockClear());

const check = (text: string, otherLanguageCard: boolean) =>
  CheckSession.start(
    [{ id: 0, text }],
    { preset: 'business', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [], modules: { otherLanguageCard } },
    { linter },
  );

describe('the romanised model (the never-auto-fix guard is a core protection)', () => {
  it('loads with the other-languages card off when a lowercase word is flagged: the guard needs it', async () => {
    const s = await check('We went to the temple for dharshan in the morning.', false);
    expect(loadRomanisedModel).toHaveBeenCalled();
    expect(s.decisions().top.concat(s.decisions().more).some((d) => d.kind === 'otherLanguage')).toBe(false);
  });

  it('is not loaded for a check with no lowercase word flag, whatever the switch', async () => {
    await check('Priya Deshmukh met us. Fine text.', false);
    await check('Priya Deshmukh met us. Fine text.', true);
    expect(loadRomanisedModel).not.toHaveBeenCalled();
  });
});
