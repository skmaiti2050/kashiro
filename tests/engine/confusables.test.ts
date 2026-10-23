/**
 * The curated Indian-English confusables rule (Task U3 item 6): a few high-confidence pairs in context,
 * always for review, never applied automatically. The sample sentences are from the owner's test text.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { findConfusables } from '@/engine/confusables';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';

const flags = (text: string) => findConfusables({ id: 0, text }).map((c) => `${c.original} → ${c.replacements.join(' | ')}`);

describe('findConfusables', () => {
  it.each([
    ['my mother and sister refused due to lower cast.', ['cast → caste']],
    ['Upper-cast families objected.', ['cast → caste']],
    ['She has a scheduled cast certificate.', ['cast → caste']],
    ['The cast system is still strong.', ['cast → caste']],
    ['It was an inter-cast marriage.', ['inter-cast → inter-caste']],
    ['It was an intercast marriage.', ['intercast → intercaste']],
    ['Members of the lower casts were excluded.', ['casts → castes']],
    ['I am trying to diet so I will loose weight.', ['loose → lose']],
    ['He is loosing money every month.', ['loosing → losing']],
    ['they spend a lot of time in call when my brother is outside for work.', ['in call → on calls | on a call']],
    ['She could not cope up with the pressure.', ['cope up with → cope with']],
    ['Coping up with change is hard.', ['Coping up with → Coping with']],
  ])('%s', (text, expected) => {
    expect(flags(text)).toEqual(expected);
  });

  it.each([
    'The film has a talented cast.',
    'The cast of the play bowed.',
    'He cast his vote early.',
    'She will lose weight.',
    'I want to loose weight.', // Harper flags "to loose" itself
    'The knot came loose.',
    'Loose clothing is cooler in summer.',
    'She works in call centres in Pune.',
    'The doctor is on call tonight.',
    'Lower caste groups organised the march.',
  ])('no flag: %s', (text) => {
    expect(flags(text)).toEqual([]);
  });

  it('skips matches inside locked spans (a quotation)', () => {
    const text = 'He wrote "lower cast" in the form.';
    const start = text.indexOf('"');
    expect(findConfusables({ id: 0, text }, [{ start, end: text.indexOf('"', start + 1) + 1 }])).toEqual([]);
  });
});

describe('confusables in a check', () => {
  let linter: RulesLinter;
  beforeAll(async () => {
    linter = await createLinter('Indian');
  });

  const SAMPLE =
    'My brother had arranged marriage even though he liked a different girl but my mother and sister refused due to lower cast.\n' +
    'Now I got to know from a few sources that he has been talking to this woman all along, they spend a lot of time in call when my brother is outside for work.';

  it("the owner's sample: \"lower cast\" and \"in call\" are offered for review, never applied", async () => {
    const s = await CheckSession.start([{ id: 0, text: SAMPLE }], { preset: 'blog', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] }, { linter });
    const found = s.candidates().filter((c) => c.original === 'cast' || c.original === 'in call');
    expect(found.map((c) => [c.original, c.replacements[0], s.tier(c.id)])).toEqual([
      ['cast', 'caste', 'review'],
      ['in call', 'on calls', 'review'],
    ]);
    expect(s.outcomes().filter((o) => o.auto)).toEqual([]);
    const ranked = [...s.decisions().top, ...s.decisions().more].flatMap((d) => d.candidateIds);
    for (const c of found) expect(ranked).toContain(c.id);
  });

  it('stays review even when the user marks Word choice as safe', async () => {
    const s = await CheckSession.start(
      [{ id: 0, text: 'They refused due to lower cast.' }],
      { preset: 'blog', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [], tierOverrides: { WordChoice: 'safe' } },
      { linter },
    );
    const cast = s.candidates().find((c) => c.original === 'cast')!;
    expect(s.tier(cast.id)).toBe('review');
  });

  it('replaces Harper\'s wrong split of "intercast" ("inter cast")', async () => {
    const s = await CheckSession.start([{ id: 0, text: 'It was an intercast marriage.' }], { preset: 'blog', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] }, { linter });
    expect(s.candidates().filter((c) => c.original === 'intercast').map((c) => c.replacements)).toEqual([['intercaste']]);
  });
});
