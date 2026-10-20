import { describe, it, expect } from 'vitest';
import type { Candidate, Tier } from '@/engine/types';
import { PRESETS } from '@/engine/presets';
import type { Preset } from '@/engine/presets';
import { tierOf, buildDecisions, findContractions, foldsUnderMore } from '@/engine/tiers';
import type { TierContext } from '@/engine/tiers';
import { findLockedSpans } from '@/engine/factLock';
import { findInvisible } from '@/engine/hygiene';
import { createLinter } from '@/engine/linter';

let n = 0;
function cand(p: Partial<Candidate> & { original: string }): Candidate {
  const start = p.span?.start ?? 0;
  const span = p.span ?? { start, end: start + p.original.length };
  const kind = p.kind ?? 'Spelling';
  return {
    id: p.id ?? `${p.paraId ?? 0}:${span.start}:${span.end}:${kind}:${n++}`,
    paraId: p.paraId ?? 0,
    span,
    original: p.original,
    replacements: p.replacements ?? [],
    kind,
    message: p.message ?? 'msg',
    source: p.source ?? 'rules',
  };
}

function ctx(over: Partial<TierContext> = {}): TierContext {
  return { locked: new Map(), variantWords: new Set(), preset: PRESETS.business, ...over };
}

describe('tierOf: safe rules', () => {
  it.each(['Spelling', 'Typo', 'Repetition', 'Punctuation', 'Capitalization', 'Formatting'])(
    'rules %s with one replacement is safe',
    (kind) => {
      expect(tierOf(cand({ original: 'teh', replacements: ['the'], kind }), ctx())).toBe('safe');
    },
  );

  it('teh → the is safe', () => {
    expect(tierOf(cand({ original: 'teh', replacements: ['the'] }), ctx())).toBe('safe');
  });

  it('hygiene candidates are safe', () => {
    const [c] = findInvisible({ id: 1, text: 'a​b' });
    expect(tierOf(c, ctx())).toBe('safe');
  });

  it('a ↔ an (Miscellaneous) is safe both ways', () => {
    expect(tierOf(cand({ original: 'a', replacements: ['an'], kind: 'Miscellaneous' }), ctx())).toBe('safe');
    expect(tierOf(cand({ original: 'an', replacements: ['a'], kind: 'Miscellaneous' }), ctx())).toBe('safe');
  });

  it('other Miscellaneous is review', () => {
    expect(tierOf(cand({ original: 'the', replacements: ['a'], kind: 'Miscellaneous' }), ctx())).toBe('review');
  });

  it('Capitalization may start with uppercase', () => {
    expect(tierOf(cand({ original: 'I', replacements: ['i'], kind: 'Capitalization' }), ctx())).toBe('safe');
  });
});

describe('tierOf: review rules', () => {
  it('Sujit with 3 suggestions → review', () => {
    expect(tierOf(cand({ original: 'Sujit', replacements: ['Suit', 'Sujith', 'Submit'] }), ctx())).toBe('review');
  });

  it('single-suggestion spelling of a capitalised word → review', () => {
    expect(tierOf(cand({ original: 'Ramesh', replacements: ['Rameses'] }), ctx())).toBe('review');
  });

  it('colour when variantWords has it → review', () => {
    const c = cand({ original: 'Colour'.toLowerCase(), replacements: ['color'] });
    expect(tierOf(c, ctx({ variantWords: new Set(['colour']) }))).toBe('review');
    expect(tierOf(c, ctx())).toBe('safe');
  });

  it('Its → [It\'s, It has] → review', () => {
    expect(tierOf(cand({ original: 'Its', replacements: ["It's", 'It has'], kind: 'Miscellaneous' }), ctx())).toBe('review');
  });

  it('has → [have] (Agreement) → review', () => {
    expect(tierOf(cand({ original: 'has', replacements: ['have'], kind: 'Agreement' }), ctx())).toBe('review');
  });

  it('no replacement → review', () => {
    expect(tierOf(cand({ original: 'teh', replacements: [] }), ctx())).toBe('review');
  });

  it('Typo overlapping a URL → review', () => {
    const text = 'See https://exmaple.com/teh for it.';
    const locked = new Map([[0, findLockedSpans(text)]]);
    const start = text.indexOf('teh');
    const c = cand({ original: 'teh', replacements: ['the'], kind: 'Typo', span: { start, end: start + 3 } });
    expect(tierOf(c, ctx({ locked }))).toBe('review');
    // same candidate in another paragraph is not locked
    expect(tierOf({ ...c, paraId: 1 }, ctx({ locked }))).toBe('safe');
  });

  it('half-open overlap: touching a locked span is not overlap', () => {
    const locked = new Map([[0, [{ start: 5, end: 10 }]]]);
    const before = cand({ original: 'teh', replacements: ['the'], span: { start: 2, end: 5 } });
    const after = cand({ original: 'teh', replacements: ['the'], span: { start: 10, end: 13 } });
    const inside = cand({ original: 'teh', replacements: ['the'], span: { start: 9, end: 12 } });
    expect(tierOf(before, ctx({ locked }))).toBe('safe');
    expect(tierOf(after, ctx({ locked }))).toBe('safe');
    expect(tierOf(inside, ctx({ locked }))).toBe('review');
  });

  it('zero-length candidate strictly inside a locked span overlaps; at its edge does not', () => {
    const locked = new Map([[0, [{ start: 5, end: 10 }]]]);
    const ins = (at: number) => cand({ original: '', replacements: [','], kind: 'Punctuation', span: { start: at, end: at } });
    expect(tierOf(ins(7), ctx({ locked }))).toBe('review');
    expect(tierOf(ins(5), ctx({ locked }))).toBe('safe');
    expect(tierOf(ins(10), ctx({ locked }))).toBe('safe');
  });

  it('any llm source → review', () => {
    expect(tierOf(cand({ original: 'teh', replacements: ['the'], source: 'llm' }), ctx())).toBe('review');
    expect(tierOf(cand({ original: 'x', replacements: ['y'], kind: 'Rewrite', source: 'llm' }), ctx())).toBe('review');
  });
});

describe('presets', () => {
  const style = cand({ original: 'very unique', replacements: ['unique'], kind: 'Style' });
  const read = cand({ original: 'long', replacements: [], kind: 'Readability' });
  const enh = cand({ original: 'good', replacements: ['excellent'], kind: 'Enhancement' });

  it('script hides Style, Readability, Enhancement', () => {
    const c = ctx({ preset: PRESETS.script });
    expect(tierOf(style, c)).toBe('hidden');
    expect(tierOf(read, c)).toBe('hidden');
    expect(tierOf(enh, c)).toBe('hidden');
    expect(tierOf(cand({ original: 'has', replacements: ['have'], kind: 'Agreement' }), c)).toBe('review');
  });

  it('blog hides Enhancement only', () => {
    const c = ctx({ preset: PRESETS.blog });
    expect(tierOf(enh, c)).toBe('hidden');
    expect(tierOf(style, c)).toBe('review');
  });

  it('business hides nothing', () => {
    expect(PRESETS.business.hiddenKinds).toEqual([]);
    expect(tierOf(enh, ctx())).toBe('review');
  });

  it('academic adds contractions as review', () => {
    expect(PRESETS.academic.extraRules).toContain('contractions');
    const [c] = findContractions({ id: 3, text: "We don't know." });
    expect(c).toMatchObject({
      paraId: 3,
      kind: 'Contraction',
      source: 'preset',
      original: "don't",
      replacements: ['do not'],
      span: { start: 3, end: 8 },
    });
    expect(tierOf(c, ctx({ preset: PRESETS.academic }))).toBe('review');
  });

  it('every preset has id and label', () => {
    for (const [id, p] of Object.entries(PRESETS) as [string, Preset][]) {
      expect(p.id).toBe(id);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});

describe('findContractions', () => {
  it('handles curly apostrophes, case and ambiguous forms', () => {
    const cs = findContractions({ id: 0, text: 'Can’t stop. It\'s late. WON\'T go. The dog\'s bowl.' });
    expect(cs.map((c) => [c.original, c.replacements])).toEqual([
      ['Can’t', ['Cannot']],
      ["It's", ['It is', 'It has']],
      ["WON'T", ['WILL NOT']],
    ]);
    expect(cs[0].id).toBe('0:0:5:Contraction');
  });
});

describe('Task 10 budget tuning', () => {
  it('(1) batch key lowercases the replacement: It\'s→Its and it\'s→its batch together', () => {
    const a = cand({ original: "It's", replacements: ['Its'], kind: 'Agreement' });
    const b = cand({ paraId: 1, original: "it's", replacements: ['its'], kind: 'Agreement' });
    const { decisions } = buildDecisions([a, b], new Map([[a.id, 'review'], [b.id, 'review']]));
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe('batch');
    expect(decisions[0].candidateIds).toEqual([a.id, b.id]);
  });

  it('(2) uppercase-start guard applies only to Spelling and Typo', () => {
    const rep = cand({ original: 'The the', replacements: ['The'], kind: 'Repetition' });
    expect(tierOf(rep, ctx())).toBe('safe');
    expect(tierOf(cand({ original: 'Teh', replacements: ['The'], kind: 'Typo' }), ctx())).toBe('review');
    expect(tierOf(cand({ original: 'Recieve', replacements: ['Receive'], kind: 'Spelling' }), ctx())).toBe('review');
  });

  it('(3) findContractions skips contractions inside locked spans', () => {
    const text = 'He said "don\'t go" and didn\'t.';
    const cs = findContractions({ id: 0, text }, findLockedSpans(text));
    expect(cs.map((c) => c.original)).toEqual(["didn't"]);
  });

  it('safety: a Spelling/Typo fix is safe only one edit away and without adding a space', () => {
    const t = (original: string, r: string, kind = 'Spelling') => tierOf(cand({ original, replacements: [r], kind }), ctx());
    expect(t('teh', 'the', 'Typo')).toBe('safe'); // transposition
    expect(t('occured', 'occurred')).toBe('safe'); // insertion
    expect(t('wierd', 'weird')).toBe('safe');
    expect(t('panchayat', 'penchant')).toBe('review');
    expect(t('jugaad', 'jugged')).toBe('review');
    expect(t('borewell', 'bore well', 'Typo')).toBe('review');
    expect(t('arived', 'a rived', 'Typo')).toBe('review');
    // other safe kinds are unaffected by the distance rule
    expect(t('is is', 'is', 'Repetition')).toBe('safe');
    // joining or splitting words (space or hyphen) is a style choice, not a slip
    expect(t('up stairs', 'upstairs')).toBe('review');
    expect(t('mid-day', 'midday')).toBe('review');
    expect(t('re-check', 'recheck')).toBe('review');
    expect(t('dont', "don't")).toBe('safe');
  });

  it('safety: a Capitalization fix right after an abbreviation is not safe', () => {
    const text = 'We thank Mr. and Mrs. Rao. the end.';
    const and = cand({ original: 'and', span: { start: 13, end: 16 }, replacements: ['And'], kind: 'Capitalization' });
    const the = cand({ original: 'the', span: { start: 27, end: 30 }, replacements: ['The'], kind: 'Capitalization' });
    const c = ctx({ paraText: new Map([[0, text]]) });
    expect(tierOf(and, c)).toBe('review');
    expect(tierOf(the, c)).toBe('safe');
    // and it folds under "more": the linter misread the abbreviation as a sentence end
    expect(foldsUnderMore(and, [], text)).toBe(true);
    expect(foldsUnderMore(the, [], text)).toBe(false);
  });

  it('(4) repeats of an unknown word that cannot batch fold; the first stays ranked', () => {
    const a = cand({ original: 'talukas', replacements: ['talks', 'talus'] });
    const b = cand({ paraId: 1, original: 'Talukas', replacements: ['Talks', 'Talus'] });
    const other = cand({ paraId: 2, original: 'siltation', replacements: ['salvation', 'situation'] });
    const all = [a, b, other];
    const { decisions, folded } = buildDecisions(all, new Map(all.map((c) => [c.id, 'review' as Tier])));
    expect(decisions.map((d) => d.id)).toEqual([a.id, other.id]);
    expect(folded.map((d) => d.id)).toEqual([b.id]);
  });

  it('(4) repeats of the same flag without a single fix fold, for any kind', () => {
    const msg = { kind: 'Regionalism', replacements: [], message: "`coriander` isn't used in Indian English." };
    const a = cand({ ...msg, original: 'coriander' });
    const b = cand({ ...msg, paraId: 3, original: 'coriander' });
    const { decisions, folded } = buildDecisions([a, b], new Map([[a.id, 'review'], [b.id, 'review']]));
    expect(decisions.map((d) => d.id)).toEqual([a.id]);
    expect(folded.map((d) => d.id)).toEqual([b.id]);
  });

  it('(4) a sentence-initial flag of a word that is fact-locked elsewhere folds too', () => {
    const text = 'Marathwada is dry. Rain in Marathwada fell.';
    const locked = findLockedSpans(text);
    const first = cand({ original: 'Marathwada', span: { start: 0, end: 10 }, replacements: ['Maratha', "Maratha's"] });
    const second = cand({ original: 'Marathwada', span: { start: 27, end: 37 }, replacements: ['Maratha', "Maratha's"] });
    const teh = cand({ original: 'Teh', span: { start: 0, end: 3 }, paraId: 1, replacements: ['The', 'Tech'] });
    const all = [first, second, teh];
    const { decisions, folded } = buildDecisions(
      all,
      new Map(all.map((c) => [c.id, 'review' as Tier])),
      (c) => c.paraId === 0 && foldsUnderMore(c, locked),
    );
    expect(decisions.map((d) => d.id)).toEqual([teh.id]);
    expect(folded.map((d) => d.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('(4) any candidate on a fact-locked span folds', () => {
    const text = 'See pages 41-48 now.';
    const locked = findLockedSpans(text);
    const dash = cand({ original: '-', span: { start: 12, end: 13 }, replacements: ['–'], kind: 'Formatting' });
    const { decisions, folded } = buildDecisions([dash], new Map([[dash.id, 'review']]), (c) => foldsUnderMore(c, locked));
    expect(decisions).toEqual([]);
    expect(folded.map((d) => d.id)).toEqual([dash.id]);
  });

  it('(4) fact-locked name flags fold under "more"; a sentence-initial misspelling does not', () => {
    const text = 'Recieve it. We met Anjali today.';
    const locked = findLockedSpans(text);
    const name = cand({ original: 'Anjali', span: { start: 19, end: 25 }, replacements: ['Alkali', 'Anal'] });
    const typo = cand({ original: 'Recieve', span: { start: 0, end: 7 }, replacements: ['Receive', 'Relieve'] });
    const fold = (c: Candidate) => foldsUnderMore(c, locked);
    const { decisions, folded } = buildDecisions([typo, name], new Map([[typo.id, 'review'], [name.id, 'review']]), fold);
    expect(decisions.map((d) => d.id)).toEqual([typo.id]);
    expect(folded.map((d) => d.id)).toEqual([name.id]);
  });
});

describe('userTierOverrides', () => {
  const agr = cand({ original: 'has', replacements: ['have'], kind: 'Agreement' });

  it('Agreement: safe makes has → have safe', () => {
    expect(tierOf(agr, ctx({ userTierOverrides: { Agreement: 'safe' } }))).toBe('safe');
  });

  it('override to safe on llm is ignored', () => {
    const llm = cand({ original: 'x', replacements: ['y'], kind: 'Rewrite', source: 'llm' });
    expect(tierOf(llm, ctx({ userTierOverrides: { Rewrite: 'safe' } }))).toBe('review');
  });

  it('override to safe on a fact-locked span is ignored', () => {
    const locked = new Map([[0, [{ start: 0, end: 10 }]]]);
    expect(tierOf(agr, ctx({ locked, userTierOverrides: { Agreement: 'safe' } }))).toBe('review');
  });

  it('override to safe with several replacements stays review', () => {
    const c = cand({ original: 'Its', replacements: ["It's", 'It has'], kind: 'Miscellaneous' });
    expect(tierOf(c, ctx({ userTierOverrides: { Miscellaneous: 'safe' } }))).toBe('review');
  });

  it('Spelling: safe override never makes capitalised words or variant words safe', () => {
    const c = ctx({ variantWords: new Set(['colour']), userTierOverrides: { Spelling: 'safe' } });
    expect(tierOf(cand({ original: 'Ramesh', replacements: ['Rameses'] }), c)).toBe('review');
    expect(tierOf(cand({ original: 'colour', replacements: ['color'] }), c)).toBe('review');
    // control: ordinary lowercase single-suggestion spelling is still safe
    expect(tierOf(cand({ original: 'teh', replacements: ['the'] }), c)).toBe('safe');
  });

  it('override can demote safe kinds to review and unhide preset-hidden kinds', () => {
    const teh = cand({ original: 'teh', replacements: ['the'] });
    expect(tierOf(teh, ctx({ userTierOverrides: { Spelling: 'review' } }))).toBe('review');
    const style = cand({ original: 'a', replacements: ['b'], kind: 'Style' });
    expect(tierOf(style, ctx({ preset: PRESETS.script, userTierOverrides: { Style: 'review' } }))).toBe('review');
  });
});

describe('buildDecisions', () => {
  const tiersOf = (cs: Candidate[], t: Tier | ((c: Candidate) => Tier)) =>
    new Map(cs.map((c) => [c.id, typeof t === 'function' ? t(c) : t]));

  it("nine it's → its in different paragraphs batch into one decision", () => {
    const cs = Array.from({ length: 9 }, (_, i) =>
      cand({ paraId: i, original: "it's", replacements: ['its'], kind: 'Miscellaneous' }),
    );
    const { safe, decisions } = buildDecisions(cs, tiersOf(cs, 'review'));
    expect(safe).toEqual([]);
    expect(decisions).toHaveLength(1);
    const [d] = decisions;
    expect(d.kind).toBe('batch');
    expect(d.candidateIds).toEqual(cs.map((c) => c.id));
    expect(d.label).toBe("it's → its (9 places)");
    expect(d.id).toBe("batch:Miscellaneousit's→its");
  });

  it('two identical review candidates batch; a lone one stays single', () => {
    const a = cand({ original: 'Affect', replacements: ['effect'], kind: 'WordChoice' });
    const b = cand({ paraId: 2, original: 'affect', replacements: ['effect'], kind: 'WordChoice' });
    const c = cand({ original: 'then', replacements: ['than'], kind: 'WordChoice' });
    const { decisions } = buildDecisions([a, b, c], tiersOf([a, b, c], 'review'));
    expect(decisions.map((d) => d.kind).sort()).toEqual(['batch', 'single']);
    const single = decisions.find((d) => d.kind === 'single')!;
    expect(single.id).toBe(c.id);
    expect(single.candidateIds).toEqual([c.id]);
    expect(decisions.find((d) => d.kind === 'batch')!.candidateIds).toEqual([a.id, b.id]);
  });

  it('multi-replacement candidates never batch', () => {
    const cs = [0, 1].map((p) => cand({ paraId: p, original: 'Its', replacements: ["It's", 'It has'], kind: 'Miscellaneous' }));
    const { decisions } = buildDecisions(cs, tiersOf(cs, 'review'));
    expect(decisions.map((d) => d.kind)).toEqual(['single', 'single']);
  });

  it('safe ids are returned, never batched; hidden are dropped', () => {
    const s1 = cand({ original: 'teh', replacements: ['the'] });
    const s2 = cand({ paraId: 1, original: 'teh', replacements: ['the'] });
    const h = cand({ original: 'x', replacements: ['y'], kind: 'Style' });
    const r = cand({ original: 'has', replacements: ['have'], kind: 'Agreement' });
    const tiers = new Map<string, Tier>([[s1.id, 'safe'], [s2.id, 'safe'], [h.id, 'hidden'], [r.id, 'review']]);
    const { safe, decisions } = buildDecisions([s1, s2, h, r], tiers);
    expect(safe).toEqual([s1.id, s2.id]);
    expect(decisions.map((d) => d.id)).toEqual([r.id]);
  });

  it('ranks by kind weight; batch +1; names score 0 and sort last', () => {
    const name = cand({ original: 'Sujit', replacements: ['Suit', 'Sujith'] });
    const style = cand({ original: 'x', replacements: ['y'], kind: 'Style' });
    const agr = cand({ original: 'has', replacements: ['have'], kind: 'Agreement' });
    const usage = cand({ original: 'u', replacements: ['v'], kind: 'Usage' });
    const punct = [0, 1].map((p) => cand({ paraId: p, original: ';', replacements: [','], kind: 'Punctuation' }));
    const contr = cand({ original: "don't", replacements: ['do not'], kind: 'Contraction', source: 'preset' });
    const variant = cand({ original: 'colour', replacements: ['color'], kind: 'Variant' });
    const rewrite = cand({ original: 'a b', replacements: ['b a'], kind: 'Rewrite', source: 'llm' });
    const all = [name, style, contr, usage, agr, variant, rewrite, ...punct];
    const { decisions } = buildDecisions(all, tiersOf(all, 'review'));
    const score = (id: string) => decisions.find((d) => d.candidateIds.includes(id))!.score;
    expect(score(agr.id)).toBe(5);
    expect(score(usage.id)).toBe(4);
    expect(score(rewrite.id)).toBe(4);
    expect(score(punct[0].id)).toBe(4); // Punctuation 3 + batch 1
    expect(score(variant.id)).toBe(3);
    expect(score(contr.id)).toBe(2);
    expect(score(style.id)).toBe(1);
    expect(score(name.id)).toBe(0);
    const scores = decisions.map((d) => d.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(decisions[decisions.length - 1].candidateIds).toEqual([name.id]);
    // ties keep input order: usage before rewrite before the punctuation batch
    expect(decisions.slice(1, 4).map((d) => d.candidateIds[0])).toEqual([usage.id, rewrite.id, punct[0].id]);
  });

  it('single labels show the fix, or the message when there is none', () => {
    const a = cand({ original: 'Its', replacements: ["It's", 'It has'], kind: 'Miscellaneous' });
    const b = cand({ original: 'long one', replacements: [], kind: 'Readability', message: 'Sentence is long' });
    const { decisions } = buildDecisions([a, b], tiersOf([a, b], 'review'));
    expect(decisions.map((d) => d.label)).toEqual(["Its → It's / It has", 'long one: Sentence is long']);
  });
});

describe('with Harper', () => {
  it('teh is safe, Sujit is review, a/an is safe', async () => {
    const l = await createLinter('American');
    const text = 'Sujit saw teh dog and a apple.';
    const cs = await l.lintParagraphs([{ id: 0, text }], 'plaintext');
    const c = ctx({ locked: new Map([[0, findLockedSpans(text)]]) });
    const by = (o: string) => cs.find((x) => x.original === o)!;
    expect(tierOf(by('teh'), c)).toBe('safe');
    expect(tierOf(by('Sujit'), c)).toBe('review');
    expect(tierOf(by('a'), c)).toBe('safe');
  });
});
