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

  it('used twice it stays a normal flag', () => {
    const cs = flagsOf(two, 'sarpanch');
    const d = decide(two, cs);
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

  it('words the user kept as typos leave the card', () => {
    const cs = flagsOf(three, 'sarpanch');
    const r = buildDecisions(cs, review(cs), { paraText: new Map([[0, three]]), typoWords: new Set(['sarpanch']) });
    expect(r.decisions.map((x) => x.kind)).toEqual(['batch']);
  });
});

describe('COMMON_WORDS list', () => {
  it('holds about 5,000 lowercase words, the core ones included', () => {
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
  const text =
    'Each dosha has a role. The dosha shifts with the season, and a dosha can rise. ' +
    'The vivax strain spread. A vivax case was found, then a third vivax case.';

  it('counts as one ranked decision: the ranked count drops by (terms − 1)', async () => {
    const withCard = await CheckSession.start([{ id: 0, text }], opts(), { linter });
    const card = [...withCard.decisions().top, ...withCard.decisions().more].find((d) => d.kind === 'terms')!;
    expect(card.counts).toEqual({ dosha: 3, vivax: 3 });
    const without = await CheckSession.start([{ id: 0, text }], opts({ termMinRepeats: 5 }), { linter });
    expect(withCard.rankedDecisionCount()).toBe(without.rankedDecisionCount() - (2 - 1));
  });

  it('acceptTerms adds the words to the dictionary; a later check does not flag them', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts()); // own linter: words are added to it
    await s.acceptTerms([]);
    expect(s.addedWords().sort()).toEqual(['dosha', 'vivax']);
    expect(s.rankedDecisionCount()).toBe(0);
    const again = await CheckSession.start([{ id: 0, text }], opts({ dictionary: s.addedWords() }));
    expect(again.candidates().filter((c) => ['dosha', 'vivax'].includes(c.original))).toEqual([]);
  });

  it('keepAsTypos splits a word out of the card into its own decision', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts());
    await s.acceptTerms(['VIVAX']);
    expect(s.addedWords()).toEqual(['dosha']);
    const left = [...s.decisions().top, ...s.decisions().more];
    expect(left.map((d) => d.kind)).toEqual(['batch']);
    expect(left[0].label).toMatch(/^vivax/);
  });

  it('accept refuses the terms card (it is answered with acceptTerms)', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts(), { linter });
    expect(() => s.accept('terms', 0)).toThrow(/acceptTerms/);
  });

  it.each([1, 6, 2.5])('termMinRepeats %s is out of range', async (n) => {
    await expect(CheckSession.start([{ id: 0, text }], opts({ termMinRepeats: n }), { linter })).rejects.toThrow(/2 to 5/);
  });
});
