import { describe, it, expect, beforeAll } from 'vitest';
import type { Candidate, Tier } from '@/engine/types';
import { buildDecisions } from '@/engine/decisions';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { isRomanisedIndic } from '@/engine/romanised/classifier';

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
    });
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
});
