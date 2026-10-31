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
import { carryDecisions, userDecisions } from '@/engine/carryDecisions';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { dictionaryAccepts, dictionaryForm, duplicateCount, withDuplicatesMerged, withTitleCaseLowered, withWordAdded } from '@/engine/dictionaryWords';
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

describe('Merge duplicates (F22 item 1, the owner’s 29-word dictionary)', () => {
  const OWNER = ['Vantix', 'vantix', 'VPC', 'vpc', 'UBUNTU', 'ubuntu', 'AMI', 'ami', 'Nashik'];

  it('keeps the lowercase form of each case group, in the place of its first entry', () => {
    expect(withDuplicatesMerged(OWNER)).toEqual({ dictionary: ['vantix', 'vpc', 'ubuntu', 'ami', 'Nashik'], merged: 4 });
    expect(duplicateCount(OWNER)).toBe(4);
  });

  it('without a lowercase form, keeps the first as written', () => {
    expect(withDuplicatesMerged(['VPC', 'Vpc', 'Anjali'])).toEqual({ dictionary: ['VPC', 'Anjali'], merged: 1 });
  });

  it('collapses NFC variants (a decomposed and a composed "Café") into the composed form', () => {
    const decomposed = 'Café';
    expect(withDuplicatesMerged([decomposed, 'Café'])).toEqual({ dictionary: ['Café'], merged: 1 });
  });

  it('no duplicates: the same list and 0, so the button is disabled', () => {
    expect(withDuplicatesMerged(['vantix', 'Nashik'])).toEqual({ dictionary: ['vantix', 'Nashik'], merged: 0 });
    expect(duplicateCount([])).toBe(0);
  });
});

describe('adding a word keeps one entry per word (Task F21 item G, owner)', () => {
  it('a lowercase word replaces its other-case entries', () => {
    expect(withWordAdded(['Vantix', 'Nashik', 'VANTIX'], 'vantix')).toEqual(['Nashik', 'vantix']);
    expect(withWordAdded(['VPC', 'AMI'], 'vpc')).toEqual(['AMI', 'vpc']);
  });

  it('a capitalised word adds nothing when an entry already accepts it', () => {
    expect(withWordAdded(['vantix'], 'Vantix')).toEqual(['vantix']);
    expect(withWordAdded(['vantix'], 'VANTIX')).toEqual(['vantix']);
    expect(withWordAdded(['VPC'], 'VPC')).toEqual(['VPC']);
    // Since Task F29 a title-case word is stored in lowercase, which replaces the saved "Vantix".
    expect(withWordAdded(['Vantix'], 'Vantix')).toEqual(['vantix']);
  });

  it('any other word is added at the end, and nothing else changes', () => {
    expect(withWordAdded(['vantix'], 'DNSName')).toEqual(['vantix', 'DNSName']);
    expect(withWordAdded(['Vantix'], 'VPC')).toEqual(['Vantix', 'VPC']);
    // "VANTIX" is no case of "nashik": a lowercase word removes only its own other cases.
    expect(withWordAdded(['VANTIX'], 'nashik')).toEqual(['VANTIX', 'nashik']);
    expect(withWordAdded([], 'teh')).toEqual(['teh']);
  });

  it('compares words in one Unicode form and one locale-free lowercase (Task F21c, review M-27)', () => {
    const decomposed = 'café';
    // Turkish dotted capital I: "İstanbul".toLowerCase() is "i̇stanbul" (with U+0307), still the same word.
    expect(withWordAdded(['İstanbul'], 'istanbul')).toEqual(['istanbul']);
    expect(withWordAdded(['istanbul'], 'İstanbul')).toEqual(['istanbul']);
    expect(dictionaryAccepts('istanbul', 'İstanbul')).toBe(true);
    // A decomposed accent is the same word as the composed one; the entry is stored composed (NFC).
    expect(withWordAdded(['Café'], decomposed)).toEqual(['café']);
    expect(withWordAdded(['café'], 'Café')).toEqual(['café']);
    expect(withWordAdded([], decomposed)).toEqual(['café']);
    expect(dictionaryAccepts('café', 'CAFÉ')).toBe(true);
    // Different letters stay different words.
    expect(withWordAdded(['DIŞ'], 'dış')).toEqual(['DIŞ', 'dış']);
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

  // #11: the fix under the rewrite was left alone, and the next re-check dropped it and the rewrite without a word.
  it('a fix an AI rewrite was made over is taken back with the same log entry; the rewrite stays, through a re-check too', async () => {
    const own = await createLinter('Indian');
    const s = await CheckSession.start(TEXT, opts(), { linter: own });
    const one = decisionOf(s, 0, 'recieve');
    s.applyBatch(one.decision.id, [one.candidate.id]);
    expect(s.addRewrite(0, { start: 0, end: 'I recieve it.'.length }, 'I do receive it.', 'I receive it.')).toEqual({ ok: true });
    const ai = s.candidates().find((c) => c.source === 'llm')!;
    s.applyRewrites([ai.id]);
    expect(s.outputText(0)).toBe('I do receive it.');
    await s.addToDictionary(decisionOf(s, 1, 'recieve').decision.id);
    expect(s.outputText(0)).toBe('I do receive it.');
    const reason = '"recieve" added to dictionary';
    expect(s.outcomes().find((o) => o.candidate.id === one.candidate.id)).toMatchObject({ status: 'rejected', reason });
    expect(s.log().filter((e) => e.candidateId === one.candidate.id).at(-1)).toMatchObject({ status: 'rejected', reason });
    expect(s.outcomes().find((o) => o.candidate.id === ai.id)!.status).toBe('applied');

    const after = await CheckSession.start(TEXT, opts({ dictionary: s.addedWords() }), { linter: own });
    recheck(s, after);
    expect(after.outputText(0)).toBe('I do receive it.');
  });

  it('adding another word of the paragraph keeps the rewrite and the fix under it through a re-check (#11)', async () => {
    const own = await createLinter('Indian');
    const POST = paras('I recieve vantix post daily.');
    const s = await CheckSession.start(POST, opts(), { linter: own });
    const fix = decisionOf(s, 0, 'recieve').candidate;
    s.accept(fix.id);
    const sentence = { start: 0, end: 'I recieve vantix post daily.'.length };
    expect(s.addRewrite(0, sentence, 'I do receive vantix post daily.', 'I receive vantix post daily.')).toEqual({ ok: true });
    const ai = s.candidates().find((c) => c.source === 'llm')!;
    s.accept(ai.id);
    await s.addTypedWord('vantix');
    expect(s.outputText(0)).toBe('I do receive vantix post daily.');
    expect(s.appliedOver(fix.id)).toBe(ai.id);

    const after = await CheckSession.start(POST, opts({ dictionary: s.addedWords() }), { linter: own });
    recheck(s, after);
    expect(after.outputText(0)).toBe('I do receive vantix post daily.');
    const twin = after.candidates().find((c) => c.original === 'recieve')!;
    expect(after.appliedOver(twin.id)).toBe(ai.id);
  });
});

/** A re-check of the same text, as the controller runs it: rule decisions first, then the AI answers. */
function recheck(before: CheckSession, after: CheckSession): void {
  const same = new Map(before.paragraphs().map((p) => [p.id, p.id]));
  carryDecisions(userDecisions(before), after, same, new Map());
  after.carryRewritesFrom(before, same);
}

/**
 * Task F29 (owner, 2026-10-30): the owner removed "Cutover", added it back, and it was stored as "Cutover" again, so
 * `cutover` in prose stayed flagged. A title-case word is now stored in lowercase (it then accepts every case); a
 * word whose case carries meaning (ALL CAPS, internal capitals) is stored as written.
 */
describe('a title-case word is stored in lowercase (Task F29)', () => {
  it('withWordAdded lowercases title case and keeps ALL CAPS and internal capitals as written', () => {
    expect(withWordAdded([], 'Cutover')).toEqual(['cutover']);
    expect(withWordAdded([], 'Mumbai')).toEqual(['mumbai']);
    expect(withWordAdded([], 'cutover')).toEqual(['cutover']);
    for (const word of ['ARN', 'ECR', 'DR', 'DBInstances', 'DNSName', 'iPhone', 'elbV2']) expect(withWordAdded([], word)).toEqual([word]);
    // The İ rule and NFC still hold; a lowercase form still replaces the word's other cases.
    expect(withWordAdded([], 'İstanbul')).toEqual(['istanbul']);
    expect(withWordAdded([], 'Café')).toEqual(['café']);
    expect(withWordAdded(['Cutover', 'ARN'], 'cutover')).toEqual(['ARN', 'cutover']);
    expect(withWordAdded(['CUTOVER'], 'Cutover')).toEqual(['cutover']);
  });

  it('every session add path stores "Cutover" as "cutover" and keeps "ARN", "DBInstances" and "DNSName"', async () => {
    const s = await CheckSession.start(paras('Cutover is tonight.'), opts(), { linter: await createLinter('Indian') });
    await s.addToDictionary(decisionOf(s, 0, 'Cutover').decision.id);
    for (const word of ['ARN', 'DBInstances', 'DNSName']) await s.addTypedWord(word);
    await s.addTypedWord('Kravix');
    expect(s.addedWords()).toEqual(['cutover', 'ARN', 'DBInstances', 'DNSName', 'kravix']);
  });

  it.each(['Cutover', 'cutover'])('after adding "%s", neither "cutover" nor "Cutover" gets a card, now or on a reopen', async (word) => {
    const TEXT = paras('Cutover is tonight.', 'The cutover runs late.');
    const s = await CheckSession.start(TEXT, opts(), { linter: await createLinter('Indian') });
    expect(flagged(s, /^cutover$/i).length).toBeGreaterThan(0);
    await s.addTypedWord(word);
    const { top, more } = s.decisions();
    const cards = [...top, ...more].filter((d) => d.candidateIds.some((id) => /^cutover$/i.test(s.candidates().find((c) => c.id === id)!.original)));
    expect(cards).toEqual([]);
    const dictionary = s.addedWords();
    const reopened = await CheckSession.start(TEXT, opts({ dictionary }), { linter: await createLinter('Indian', dictionary) });
    expect(flagged(reopened, /^cutover$/i)).toEqual([]);
  });

  it('the take-back (M-12) still works when the stored form differs in case from the card’s word', async () => {
    const s = await CheckSession.start(paras('Recieve it now.', 'Recieve the rest.'), opts(), { linter: await createLinter('Indian') });
    const one = decisionOf(s, 0, 'Recieve');
    s.applyBatch(one.decision.id, [one.candidate.id]);
    expect(s.outputText(0)).toBe('Receive it now.');
    await s.addToDictionary(decisionOf(s, 1, 'Recieve').decision.id);
    expect(s.addedWords()).toEqual(['recieve']);
    expect(s.outputText(0)).toBe('Recieve it now.');
    expect(s.outcomes().find((o) => o.candidate.id === one.candidate.id)).toMatchObject({ status: 'rejected', reason: '"recieve" added to dictionary' });
  });
});

describe('title-case entries saved before F29 are lowercased once, on load (Task F29)', () => {
  it('lowercases title case only, merging the duplicates that makes', () => {
    expect(withTitleCaseLowered(['Cutover', 'ARN', 'vantix', 'DBInstances'])).toEqual(['cutover', 'ARN', 'vantix', 'DBInstances']);
    expect(withTitleCaseLowered(['Cutover', 'cutover', 'Nashik'])).toEqual(['cutover', 'nashik']);
    expect(withTitleCaseLowered(['CUTOVER', 'Cutover'])).toEqual(['cutover']);
  });

  it('a dictionary with no title-case entry comes back as it is (nothing to save)', () => {
    const dictionary = ['ARN', 'vantix', 'DBInstances', 'VPC', 'vpc'];
    expect(withTitleCaseLowered(dictionary)).toBe(dictionary);
  });
});
