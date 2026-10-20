import { describe, it, expect } from 'vitest';
import { lockedTokens, passesGuard } from '@/engine/llm/guard';

const ORIGINAL = 'The survey found that attendance rose by 3.2% in the districts that served hot meals.';
const LOCKED = lockedTokens(ORIGINAL);

describe('passesGuard', () => {
  it('a genuine fluency rewrite passes', () => {
    const rewrite = 'The survey found attendance rose by 3.2% in the districts serving hot meals.';
    expect(passesGuard(ORIGINAL, rewrite, LOCKED)).toEqual({ ok: true });
  });

  it('lockedTokens lists the fact-locked text of the sentence', () => {
    expect(LOCKED).toEqual(['3.2%']);
    expect(lockedTokens('As Rao (2020) noted, 1,200 pupils "came daily".')).toEqual(
      expect.arrayContaining(['1,200', '"came daily"']),
    );
  });

  it('a changed locked token: fact changed', () => {
    const rewrite = 'The survey found attendance rose by 3% in the districts serving hot meals.';
    expect(passesGuard(ORIGINAL, rewrite, LOCKED)).toEqual({ ok: false, reason: 'fact changed' });
  });

  it('a new number or name the original did not have: fact changed', () => {
    const rewrite = 'The 2019 survey found attendance rose by 3.2% in the districts serving hot meals.';
    expect(passesGuard(ORIGINAL, rewrite, LOCKED)).toEqual({ ok: false, reason: 'fact changed' });
  });

  it('length over 1.5x the original: too long', () => {
    const original = 'Attendance rose by 3.2% in districts with meals.';
    const rewrite =
      'Attendance at the schools rose steadily by 3.2% in those districts that offered pupils meals with lunch every day.';
    expect(rewrite.length).toBeGreaterThan(1.5 * original.length);
    expect(passesGuard(original, rewrite, lockedTokens(original))).toEqual({ ok: false, reason: 'too long' });
  });

  it.each([
    ['dropped not', 'The scheme did not raise attendance in the 12 districts.', 'The scheme raised attendance in the 12 districts.'],
    ['added never', 'Teachers checked the registers in the 12 districts.', 'Teachers never checked the registers in the 12 districts.'],
    ["dropped n't", "Teachers didn't check the registers in the 12 districts.", 'Teachers did check the registers in the 12 districts.'],
    ['added no', 'Schools kept records in the 12 districts.', 'Schools kept no records in the 12 districts.'],
    ['dropped without', 'Schools ran the scheme without extra staff in the 12 districts.', 'Schools ran the scheme with extra staff in the 12 districts.'],
  ])('a negation change (%s): negation changed', (_name, original, rewrite) => {
    expect(passesGuard(original, rewrite, lockedTokens(original))).toEqual({ ok: false, reason: 'negation changed' });
  });

  it.each(['broadly', 'arguably', 'generally', 'somewhat', 'perhaps', 'it seems', 'to some extent'])(
    'an added hedge (%s): hedge added',
    (hedge) => {
      const original = 'Attendance rose by 3.2% in districts that served hot meals.';
      const rewrite = `Attendance ${hedge} rose by 3.2% in districts serving hot meals.`;
      expect(passesGuard(original, rewrite, lockedTokens(original))).toEqual({ ok: false, reason: 'hedge added' });
    },
  );

  it('a hedge already in the original is not "added"', () => {
    const original = 'Attendance perhaps rose in districts that served hot meals.';
    const rewrite = 'Attendance perhaps rose in districts serving hot meals.';
    expect(passesGuard(original, rewrite, [])).toEqual({ ok: true });
  });

  it('content-word overlap below 0.6: meaning drift', () => {
    const rewrite = 'Hot lunches boosted pupil turnout by 3.2% across those regions, the study showed.';
    expect(passesGuard(ORIGINAL, rewrite, LOCKED)).toEqual({ ok: false, reason: 'meaning drift' });
  });

  it('several sentences returned: not one sentence', () => {
    const rewrite = 'The survey found attendance rose by 3.2%. That was in the districts serving hot meals.';
    expect(passesGuard(ORIGINAL, rewrite, LOCKED)).toEqual({ ok: false, reason: 'not one sentence' });
  });

  it('an empty rewrite: not one sentence', () => {
    expect(passesGuard(ORIGINAL, '  ', LOCKED)).toEqual({ ok: false, reason: 'not one sentence' });
  });
});
