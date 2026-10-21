import { describe, it, expect, beforeAll } from 'vitest';
import type { Candidate, Tier } from '@/engine/types';
import { buildDecisions } from '@/engine/decisions';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { COMMON_WORDS } from '@/engine/wordlists/common';

/** Spelling flags of every whole-word `word` in `text` (paragraph 0), as Harper would report them. */
function flagsOf(text: string, word: string, replacements = ['sarong', 'parch']): Candidate[] {
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
const decide = (text: string, cs: Candidate[], termMinRepeats?: number) =>
  buildDecisions(cs, review(cs), { paraText: new Map([[0, text]]), termMinRepeats }).decisions;

describe('terms card (spec §5)', () => {
  const three = 'The sarpanch spoke. Each sarpanch voted, and the sarpanch left.';
  const two = 'The sarpanch spoke. Each sarpanch voted.';

  it('a lowercase unknown word used 3 times is a term: one card with its count', () => {
    const cs = flagsOf(three, 'sarpanch');
    expect(decide(three, cs)).toEqual([
      {
        id: 'terms',
        kind: 'terms',
        candidateIds: cs.map((c) => c.id),
        label: '1 term used in this document',
        score: 0,
        counts: { sarpanch: 3 },
      },
    ]);
  });

  it('used twice it is not a term (sarpanch goes to the other-languages card; an English-looking word stays a flag)', () => {
    expect(decide(two, flagsOf(two, 'sarpanch')).map((d) => d.kind)).toEqual(['otherLanguage']);
    const english = 'The borewells ran dry. Both borewells failed.';
    const d = decide(english, flagsOf(english, 'borewells'));
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('batch');
  });

  it('the minimum repeat count is a setting: 2 makes the pair a term', () => {
    expect(decide(two, flagsOf(two, 'sarpanch'), 2)[0].kind).toBe('terms');
  });

  it('counts uses in the text, not only flags (an unflagged use still counts)', () => {
    const cs = flagsOf(three, 'sarpanch').slice(0, 2);
    expect(decide(three, cs)[0]).toMatchObject({ kind: 'terms', counts: { sarpanch: 3 } });
  });

  it('a slip of a common word is never a term: "teh" ×3 stays a typo', () => {
    const text = 'I saw teh dog, teh cat and teh cow.';
    const d = decide(text, flagsOf(text, 'teh', ['the', 'tech']));
    expect(d.map((x) => x.kind)).toEqual(['batch']);
  });

  it('a capitalised word is not a term (it goes to the names card)', () => {
    const text = 'Sarpanch met us. We met Sarpanch and Sarpanch.';
    const d = decide(text, flagsOf(text, 'Sarpanch'));
    expect(d.map((x) => x.kind)).toEqual(['names']);
  });

  it('words shorter than 3 letters or with a digits-only part are not terms', () => {
    const text = 'xq and xq and xq; abc-123 and abc-123 and abc-123.';
    const cs = [...flagsOf(text, 'xq'), ...flagsOf(text, 'abc-123')];
    expect(decide(text, cs).map((x) => x.kind)).not.toContain('terms');
  });

  it('a word with digits inside is still a term ("hba1c")', () => {
    const text = 'The hba1c rose; a second hba1c fell; the third hba1c held.';
    expect(decide(text, flagsOf(text, 'hba1c'))[0]).toMatchObject({ kind: 'terms', counts: { hba1c: 3 } });
  });

  it('several terms share one card, ranked after other decisions and just above the names card', () => {
    const text = 'sarpanch dosha sarpanch dosha sarpanch dosha. Rao met Rao. It have.';
    const agr: Candidate = {
      id: 'agr', paraId: 0, span: { start: text.indexOf('have'), end: text.indexOf('have') + 4 }, original: 'have', replacements: ['has'],
      kind: 'Agreement', message: 'm', source: 'rules',
    };
    const cs = [...flagsOf(text, 'sarpanch'), ...flagsOf(text, 'dosha'), ...flagsOf(text, 'Rao'), agr];
    const d = decide(text, cs);
    expect(d.map((x) => x.kind)).toEqual(['single', 'terms', 'names']);
    expect(d[1]).toMatchObject({ label: '2 terms used in this document', counts: { sarpanch: 3, dosha: 3 } });
  });

  it.each([
    ['occurence', ['occurrence', 'occurrences', 'occur']],
    ['accomodate', ['accommodate', 'accommodated', 'accommodates']],
  ])('a repeated misspelling whose own suggestion is close ("%s" ×3) stays a normal decision', (word, replacements) => {
    const text = `The ${word} was noted. Another ${word} followed, and a third ${word} too.`;
    expect(decide(text, flagsOf(text, word, replacements)).map((x) => x.kind)).toEqual(['batch']);
  });

  it('a close but rare suggestion does not stop a term: "dosha" ×3 with "dosh" (Zipf 2.3)', () => {
    const text = 'Each dosha, the dosha and a dosha.';
    expect(decide(text, flagsOf(text, 'dosha', ['dosh']))[0]).toMatchObject({ kind: 'terms', counts: { dosha: 3 } });
  });

  it(`a short word's moderately common neighbours don't stop it either: "kapha" ×3 with "kappa", "karma"`, () => {
    const text = 'Each kapha, the kapha and a kapha.';
    expect(decide(text, flagsOf(text, 'kapha', ['kappa', 'karma', 'kana']))[0]).toMatchObject({ kind: 'terms', counts: { kapha: 3 } });
  });

  it('words the engine added to the suggestions do not stop a term ("coinfection" → added "infection")', () => {
    const text = 'One coinfection, a second coinfection and a third coinfection.';
    const cs = flagsOf(text, 'coinfection', ['co infection', 'infection']).map((c) => ({
      ...c,
      linterReplacements: ['co infection'],
    }));
    expect(decide(text, cs)[0].kind).toBe('terms');
  });

  it('in a hyphenated word the linter flags the part, so the part is the term ("vata-pitta" ×3 → "pitta")', () => {
    // Harper flags "pitta" alone in "vata-pitta", and a hyphenated dictionary word would not clear that flag.
    const text = 'The vata-pitta balance. Each vata-pitta type. A vata-pitta diet.';
    expect(decide(text, flagsOf(text, 'pitta'))[0]).toMatchObject({ kind: 'terms', counts: { pitta: 3 } });
  });

  it('a suggestion that only splits the word ("co infection") does not stop a term', () => {
    const text = 'One coinfection, a second coinfection and a third coinfection.';
    expect(decide(text, flagsOf(text, 'coinfection', ['co infection', 'co-infection']))[0].kind).toBe('terms');
  });

  it('a word on both cards stays on one: the terms card, counting only lowercase uses', () => {
    const text = 'Each dosha, the dosha and a dosha. We met Dosha there.';
    const cs = [...flagsOf(text, 'dosha'), ...flagsOf(text, 'Dosha')];
    expect(decide(text, cs)).toEqual([
      expect.objectContaining({ kind: 'terms', candidateIds: cs.map((c) => c.id), counts: { dosha: 3 } }),
    ]);
  });

  it('with too few lowercase uses, the capitalised use goes to the names card and the rest stay words', () => {
    // "dosha" would go to the other-languages card (with its capitalised use): an English-looking word here.
    const text = 'Each borewell and a borewell. We met Borewell there.';
    const cs = [...flagsOf(text, 'borewell'), ...flagsOf(text, 'Borewell')];
    expect(decide(text, cs).map((x) => x.kind)).toEqual(['batch', 'names']);
  });

  it('words the user kept as typos leave the card', () => {
    const cs = flagsOf(three, 'sarpanch');
    const r = buildDecisions(cs, review(cs), { paraText: new Map([[0, three]]), typoWords: new Set(['sarpanch']) });
    expect(r.decisions.map((x) => x.kind)).toEqual(['batch']);
  });
});

describe('COMMON_WORDS list', () => {
  it('holds about 4,800 lowercase words, the core ones included', () => {
    expect(COMMON_WORDS.size).toBeGreaterThan(4500);
    expect(COMMON_WORDS.size).toBeLessThanOrEqual(5000);
    for (const w of COMMON_WORDS) expect(w).toMatch(/^\p{Ll}+$/u);
    for (const w of ['the', 'receive', 'government', 'which', 'believe']) expect(COMMON_WORDS.has(w)).toBe(true);
    // Junk two-letter tokens would make three-letter terms look like slips ("rti" ← "rt").
    for (const w of ['rt', 'ri', 'sarpanch']) expect(COMMON_WORDS.has(w)).toBe(false);
  });
});

describe('terms card in a session (Harper)', () => {
  let linter: RulesLinter;
  beforeAll(async () => {
    linter = await createLinter('American');
  });
  const opts = (over: Partial<CheckOptions> = {}): CheckOptions => ({
    preset: 'business',
    variant: 'American',
    fallbackVariant: 'American',
    language: 'plaintext',
    dictionary: [],
    ...over,
  });
  // Harper's suggestions for these are far off (palladium, calcifies), so they read as terms.
  const text =
    'Each plasmodium has a role. The plasmodium shifts with the season, and a plasmodium can rise. ' +
    'The culicifacies strain spread. A culicifacies case was found, then a third culicifacies case.';
  const words = ['culicifacies', 'plasmodium'];

  it('counts as one ranked decision: the ranked count drops by (terms − 1)', async () => {
    const withCard = await CheckSession.start([{ id: 0, text }], opts(), { linter });
    const card = [...withCard.decisions().top, ...withCard.decisions().more].find((d) => d.kind === 'terms')!;
    expect(card.counts).toEqual({ plasmodium: 3, culicifacies: 3 });
    const without = await CheckSession.start([{ id: 0, text }], opts({ termMinRepeats: 5 }), { linter });
    expect(withCard.rankedDecisionCount()).toBe(without.rankedDecisionCount() - (2 - 1));
  });

  it('acceptTerms adds the words to the dictionary; a later check does not flag them', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts()); // own linter: words are added to it
    await s.acceptTerms([]);
    expect(s.addedWords().sort()).toEqual(words);
    expect(s.rankedDecisionCount()).toBe(0);
    const again = await CheckSession.start([{ id: 0, text }], opts({ dictionary: s.addedWords() }));
    expect(again.candidates().filter((c) => words.includes(c.original))).toEqual([]);
  });

  it('keepAsTypos splits a word out of the card into its own decision', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts());
    await s.acceptTerms(['CULICIFACIES']);
    expect(s.addedWords()).toEqual(['plasmodium']);
    const left = [...s.decisions().top, ...s.decisions().more];
    expect(left.map((d) => d.kind)).toEqual(['batch']);
    expect(left[0].label).toMatch(/^culicifacies/);
  });

  it('accept refuses the terms card (it is answered with acceptTerms)', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts(), { linter });
    expect(() => s.accept('terms', 0)).toThrow(/acceptTerms/);
  });

  it.each([1, 6, 2.5])('termMinRepeats %s is out of range', async (n) => {
    await expect(CheckSession.start([{ id: 0, text }], opts({ termMinRepeats: n }), { linter })).rejects.toThrow(/2 to 5/);
  });
});
