import { describe, it, expect, beforeAll } from 'vitest';
import type { Candidate, Tier } from '@/engine/types';
import { buildDecisions } from '@/engine/decisions';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { isRomanisedIndic, loadRomanisedModel } from '@/engine/romanised/classifier';

beforeAll(() => loadRomanisedModel());

/** Spelling flags of every whole-word `word` in `text` (paragraph 0), as Harper would report them. */
function flagsOf(text: string, word: string, replacements = ['chalk', 'halo']): Candidate[] {
  return [...text.matchAll(new RegExp(`\\b${word}\\b`, 'g'))].map((m) => ({
    id: `0:${m.index}:${word}`,
    paraId: 0,
    span: { start: m.index!, end: m.index! + word.length },
    original: word,
    replacements,
    kind: 'Spelling',
    message: 'msg',
    source: 'rules',
  }));
}
const review = (cs: Candidate[]) => new Map(cs.map((c) => [c.id, 'review' as Tier]));
const decide = (text: string, cs: Candidate[], typoWords?: Set<string>) =>
  buildDecisions(cs, review(cs), { paraText: new Map([[0, text]]), typoWords }).decisions;

describe('isRomanisedIndic (spec §5 words in other languages)', () => {
  it.each(['accha', 'chalo', 'khub', 'bhalo', 'nahi', 'kya', 'jaldi', 'paisa'])('"%s" is romanised Hindi/Bengali', (word) => {
    expect(isRomanisedIndic(word)).toBe(true);
  });

  it.each(['teh', 'recieve', 'becuase', 'goverment', 'wierd', 'definately', 'thier', 'occured'])('the typo "%s" is not', (word) => {
    expect(isRomanisedIndic(word)).toBe(false);
  });

  it('a slip of one of the commonest English words always wins: "yaar" (year), "hai" (had), "arre" (are)', () => {
    for (const word of ['yaar', 'hai', 'arre']) expect(isRomanisedIndic(word)).toBe(false);
  });

  it('judges only lowercase a-z words: never Devanagari or Bengali script, capitals or apostrophes', () => {
    for (const word of ['अच्छा', 'খুব', 'Accha', "accha's", 'k', 'acc4a']) expect(isRomanisedIndic(word)).toBe(false);
  });

  it('English two-letter slips are never romanised, so they stay off the card', () => {
    const slips = ['ot', 'fo', 'si', 'ti', 'th', 'nd', 'ur', 'im', 'ok', 'po', 'da', 'ma', 'pa'];
    expect(slips.filter(isRomanisedIndic)).toEqual([]);
  });
});

describe('words-in-other-languages card (spec §5)', () => {
  const text = 'He said chalo, and the food was khub bhalo. I got teh letter.';

  it('flagged Hindi/Bengali words go on one card; an English typo stays its own decision', () => {
    const words = [...flagsOf(text, 'chalo'), ...flagsOf(text, 'khub'), ...flagsOf(text, 'bhalo')];
    const typo = flagsOf(text, 'teh', ['the']);
    const d = decide(text, [...words, ...typo]);
    expect(d.map((x) => x.kind)).toEqual(['single', 'otherLanguage']);
    expect(d[1]).toEqual({
      id: 'other-language',
      kind: 'otherLanguage',
      candidateIds: words.map((c) => c.id),
      label: '3 words in Hindi/Bengali',
      score: 0,
      // The rule is deliberately cautious: Bengali "khub" is one letter from "hub", so it starts unticked too.
      likelyTypos: [['khub', 'hub']],
    });
  });

  it('a card word one edit from an everyday English word (Zipf ≥ 4) is marked as a likely typo of it', () => {
    const t = 'He said chalo, we will jion the byos, the poro and the babo, and dinr bhalo.';
    const slips = ['jion', 'byos', 'poro', 'babo', 'dinr'];
    const cs = [...flagsOf(t, 'chalo'), ...flagsOf(t, 'bhalo'), ...slips.flatMap((w) => flagsOf(t, w))];
    const card = decide(t, cs).find((d) => d.kind === 'otherLanguage')!;
    expect(card.likelyTypos).toEqual([
      ['jion', 'join'],
      ['byos', 'boys'],
      ['poro', 'poor'],
      ['babo', 'baby'],
    ]);
    // "dinr" has no everyday neighbour (din, dine and diner are all below Zipf 4), so it is not marked.
  });

  it('one word: singular label; repeats of it count once', () => {
    const twice = 'Chalo then. We said chalo and chalo again.';
    const d = decide(twice, flagsOf(twice, 'chalo'));
    expect(d).toEqual([expect.objectContaining({ kind: 'otherLanguage', label: '1 word in Hindi/Bengali' })]);
  });

  it('a capitalised use joins the card when the word is also used in lowercase', () => {
    const t = 'Accha, we went. It was accha.';
    const cs = [...flagsOf(t, 'Accha', ['Accra']), ...flagsOf(t, 'accha', ['acacia'])];
    expect(decide(t, cs)).toEqual([expect.objectContaining({ kind: 'otherLanguage', candidateIds: cs.map((c) => c.id) })]);
  });

  it('a capitalised word alone stays on the names card (Indian names look Hindi too)', () => {
    const t = 'We met Venkatraman there.';
    expect(decide(t, flagsOf(t, 'Venkatraman', ['Venkatesh'])).map((x) => x.kind)).toEqual(['names']);
  });

  it('words the user kept as typos leave the card', () => {
    expect(decide(text, flagsOf(text, 'chalo'), new Set(['chalo'])).map((x) => x.kind)).toEqual(['single']);
  });

  it('a word used 3+ times is a term first: the terms card keeps it', () => {
    const t = 'The jaldi plan, a jaldi fix and the jaldi rule.';
    expect(decide(t, flagsOf(t, 'jaldi')).map((x) => x.kind)).toEqual(['terms']);
  });
});

describe('words-in-other-languages card in a session (Harper)', () => {
  let linter: RulesLinter;
  beforeAll(async () => {
    linter = await createLinter('American');
  });
  const opts: CheckOptions = { preset: 'blog', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [] };
  const text = 'He said chalo, and the food was khub bhalo. I recieved the letter.';
  const words = ['bhalo', 'chalo', 'khub'];

  it('Harper flags the romanised words and the card takes them; the typo stays a decision', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts, { linter });
    const all = [...s.decisions().top, ...s.decisions().more];
    const card = all.find((d) => d.kind === 'otherLanguage')!;
    const byId = new Map(s.candidates().map((c) => [c.id, c.original]));
    expect(card.candidateIds.map((id) => byId.get(id)).sort()).toEqual(words);
    expect(all.some((d) => d.kind !== 'otherLanguage' && d.candidateIds.some((id) => byId.get(id) === 'recieved'))).toBe(true);
  });

  it('Devanagari and Bengali script are not spell-checked as English', async () => {
    const flags = await linter.lintParagraphs([{ id: 0, text: 'यह बहुत अच्छा है। এটা খুব ভালো।' }], 'plaintext');
    expect(flags.filter((c) => c.kind === 'Spelling' || c.kind === 'Typo')).toEqual([]);
  });

  it('acceptOtherLanguage adds the words to the dictionary; keepAsTypos splits a word out', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts); // own linter: words are added to it
    await s.acceptOtherLanguage(['KHUB']);
    expect(s.addedWords().sort()).toEqual(['bhalo', 'chalo']);
    const left = [...s.decisions().top, ...s.decisions().more];
    expect(left.some((d) => d.kind === 'otherLanguage')).toBe(false);
    expect(left.some((d) => d.label.startsWith('khub'))).toBe(true);
  });

  it('accept refuses the card (it is answered with acceptOtherLanguage)', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts, { linter });
    expect(() => s.accept('other-language', 0)).toThrow(/acceptOtherLanguage/);
  });

  it('"Add all" never adds a likely typo: it splits out unless the user ticked it explicitly', async () => {
    const slipText = 'He said chalo, and we will jion the khub bhalo party.';
    const first = await CheckSession.start([{ id: 0, text: slipText }], opts);
    const card = [...first.decisions().top, ...first.decisions().more].find((d) => d.kind === 'otherLanguage')!;
    expect(card.likelyTypos).toEqual([
      ['jion', 'join'],
      ['khub', 'hub'],
    ]);
    await first.acceptOtherLanguage([]);
    expect(first.addedWords().sort()).toEqual(['bhalo', 'chalo']);
    expect([...first.decisions().top, ...first.decisions().more].some((d) => d.label.startsWith('jion'))).toBe(true);

    const second = await CheckSession.start([{ id: 0, text: slipText }], opts);
    await second.acceptOtherLanguage([], ['KHUB']);
    expect(second.addedWords().sort()).toEqual(['bhalo', 'chalo', 'khub']);
  });
});

describe('romanised words are never auto-fixed (Harper)', () => {
  let linter: RulesLinter;
  beforeAll(async () => {
    linter = await createLinter('American');
  });
  const opts: CheckOptions = { preset: 'blog', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] };
  const autoFixedIn = (s: CheckSession) =>
    s.outcomes().filter((o) => o.auto && o.status === 'applied').map((o) => `${o.candidate.original} → ${o.replacement}`);
  const autoFixed = async (text: string) => autoFixedIn(await CheckSession.start([{ id: 0, text }], opts, { linter }));

  it.each([
    ['te', 'ami kal school te jabo, tumi aschho?'], // Bengali "at", not "the"
    ['prakriti', 'Each person is born with a prakriti that shapes the doshas.'],
    ['dharshan', 'Hum mandir mein dharshan ke liye gaye the.'],
    ['bhittite', 'amader bhittite onek kaj hoyeche.'],
  ])('"%s" (romanised, or in a sentence mostly in Hindi/Bengali) goes to review, not to a slip fix', async (word, text) => {
    const s = await CheckSession.start([{ id: 0, text }], opts, { linter });
    const flag = s.candidates().find((c) => c.original === word)!;
    expect(s.tier(flag.id)).toBe('review');
    expect(autoFixedIn(s)).toEqual([]);
  });

  it('a slip in an English sentence is still fixed, also next to Hindi words or with one inside it', async () => {
    expect(await autoFixed('I got teh letter and read it.')).toEqual(['teh → the']);
    expect(await autoFixed('He said chalo. I got teh letter and read it.')).toEqual(['teh → the']);
    expect(await autoFixed('We ate the batata vadas while my father explained, for teh twentieth year, the old road.')).toEqual([
      'teh → the',
    ]);
  });
});
