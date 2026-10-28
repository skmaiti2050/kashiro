/**
 * Task F20 item 9 (owner). (a) M-12: adding a word to the dictionary after its fix was applied left the fix in the
 * text ("VPC → Vac", "vantix → craving"), and the next re-check dropped it without a word. Adding the word now undoes
 * the user's applied fixes of it, in place and in the log. (b) The owner added "Vantix" while reviewing `vantix`;
 * after a reopen `vantix` was flagged again in 26 places: the card stored its first place's spelling ("Vantix", a
 * sentence start), and a capitalised entry accepts only capitalised forms. The word is now stored as the user wrote
 * it: lowercase when any place is lowercase (then every case is accepted); a capitalised entry also accepts all caps.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { dictionaryAccepts, dictionaryForm } from '@/engine/dictionaryWords';
import type { Paragraph } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts = (over: Partial<CheckOptions> = {}): CheckOptions => ({ preset: 'blog', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [], ...over });
const paras = (...texts: string[]): Paragraph[] => texts.map((text, id) => ({ id, text }));

/** The decision holding the candidate at `original` in paragraph `paraId`. */
function decisionOf(s: CheckSession, paraId: number, original: string) {
  const c = s.candidates().find((x) => x.paraId === paraId && x.original === original && (x.kind === 'Spelling' || x.kind === 'Typo'))!;
  const { top, more } = s.decisions();
  return { candidate: c, decision: [...top, ...more].find((d) => d.candidateIds.includes(c.id))! };
}

const flagged = (s: CheckSession, word: RegExp) => s.candidates().filter((c) => (c.kind === 'Spelling' || c.kind === 'Typo') && word.test(c.original) && s.tier(c.id) !== 'hidden').map((c) => c.original);

describe('the dictionary case rule', () => {
  it('stores lowercase when any place is lowercase, else the spelling as written', () => {
    expect(dictionaryForm(['Vantix', 'vantix', 'vantix'])).toBe('vantix');
    expect(dictionaryForm(['Vantix', 'VANTIX'])).toBe('Vantix');
    expect(dictionaryForm(['VANTIX', 'Vantix'])).toBe('Vantix');
    expect(dictionaryForm(['VPC'])).toBe('VPC');
  });

  it('a lowercase entry accepts any case; any other entry itself and its all-caps form', () => {
    expect(['vantix', 'Vantix', 'VANTIX'].map((w) => dictionaryAccepts('vantix', w))).toEqual([true, true, true]);
    expect(['vantix', 'Vantix', 'VANTIX'].map((w) => dictionaryAccepts('Vantix', w))).toEqual([false, true, true]);
    expect(['vpc', 'Vpc', 'VPC'].map((w) => dictionaryAccepts('VPC', w))).toEqual([false, false, true]);
  });
});

describe('adding a word stores it as written and it holds on a reopen (Task F20 item 9b)', () => {
  const TEXT = paras('Vantix is our app.', 'We use vantix daily, and vantix often.', 'Ask vantix support.');

  it('a card whose first place is a capitalised sentence start stores the lowercase word', async () => {
    const s = await CheckSession.start(TEXT, opts(), { linter: await createLinter('Indian') });
    const { decision } = decisionOf(s, 1, 'vantix');
    await s.addToDictionary(decision.id);
    expect(s.addedWords()).toEqual(['vantix']);
  });

  it('a reopen with the saved dictionary flags the word in no case, with a fresh or a reused linter', async () => {
    const first = await CheckSession.start(TEXT, opts(), { linter: await createLinter('Indian') });
    await first.addToDictionary(decisionOf(first, 1, 'vantix').decision.id);
    const dictionary = first.addedWords();
    const fresh = await CheckSession.start([...TEXT, { id: 3, text: 'VANTIX everywhere.' }], opts({ dictionary }), { linter: await createLinter('Indian', dictionary) });
    expect(flagged(fresh, /^vantix$/i)).toEqual([]);
    const reused = await CheckSession.start([...TEXT, { id: 3, text: 'VANTIX everywhere.' }], opts({ dictionary }), { linter });
    expect(flagged(reused, /^vantix$/i)).toEqual([]);
  });

  it('a capitalised entry accepts the capitalised and all-caps forms, not lowercase', async () => {
    const s = await CheckSession.start(paras('Vantix is here. VANTIX is loud. We use vantix.'), opts({ dictionary: ['Vantix'] }), { linter: await createLinter('Indian', ['Vantix']) });
    expect(flagged(s, /^vantix$/i)).toEqual(['vantix']);
  });
});

describe('adding a word undoes the applied fixes of it (Task F20 item 9a, M-12)', () => {
  const TEXT = paras('I recieve it.', 'You recieve "sic" calls.', 'More.');

  it('a fix applied at one place is taken back when the word is added from another', async () => {
    const s = await CheckSession.start(TEXT, opts(), { linter: await createLinter('Indian') });
    const one = decisionOf(s, 0, 'recieve');
    s.applyBatch(one.decision.id, [one.candidate.id]);
    expect(s.outputText(0)).toBe('I receive it.');
    await s.addToDictionary(decisionOf(s, 1, 'recieve').decision.id);
    expect(s.outputText(0)).toBe('I recieve it.');
    const outcome = s.outcomes().find((o) => o.candidate.id === one.candidate.id)!;
    expect(outcome).toMatchObject({ status: 'rejected', reason: '"recieve" added to dictionary' });
  });

  it('never another change: a fix an AI rewrite was made over stays, and so does the rewrite', async () => {
    const s = await CheckSession.start(TEXT, opts(), { linter: await createLinter('Indian') });
    const one = decisionOf(s, 0, 'recieve');
    s.applyBatch(one.decision.id, [one.candidate.id]);
    expect(s.addRewrite(0, { start: 0, end: 'I recieve it.'.length }, 'I do receive it.', 'I receive it.')).toEqual({ ok: true });
    const ai = s.candidates().find((c) => c.source === 'llm')!;
    s.applyRewrites([ai.id]);
    expect(s.outputText(0)).toBe('I do receive it.');
    await s.addToDictionary(decisionOf(s, 1, 'recieve').decision.id);
    expect(s.outputText(0)).toBe('I do receive it.');
  });
});
