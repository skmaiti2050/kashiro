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

  /** a/an candidate on the article at the start of `text`, with the paragraph text in ctx. */
  const article = (text: string) => {
    const original = text.match(/^an?(?![a-z])/)![0];
    const c = cand({ original, replacements: [original === 'a' ? 'an' : 'a'], kind: 'Miscellaneous' });
    return tierOf(c, ctx({ paraText: new Map([[0, text]]) }));
  };

  it('a ↔ an (Miscellaneous) is safe both ways before a lowercase content word', () => {
    expect(article('a apple fell')).toBe('safe');
    expect(article('an banana fell')).toBe('safe');
  });

  it.each(['an they', 'an the', 'an we', 'an not', 'an is', 'an and', 'a it', 'an', 'an.', 'an NASA', 'an Rao', 'an 8', 'an "apple"'])(
    'a/an before %s is review',
    (text) => {
      expect(article(text)).toBe('review');
    },
  );

  // "an there was no rice" is a typo of "and": swapping to "a" changes the meaning.
  it.each([
    'who', 'what', 'when', 'where', 'why', 'how', 'which', 'there', 'here', 'then', 'than',
    'now', 'also', 'just', 'only', 'very', 'still', 'even', 'never', 'always', 'often', 'soon', 'too',
    "isn't", 'don’t', "o'clock",
  ])('a/an before the function word or contraction "%s" is review', (word) => {
    expect(article(`an ${word} more`)).toBe('review');
  });

  it('a/an without paragraph text is review', () => {
    expect(tierOf(cand({ original: 'a', replacements: ['an'], kind: 'Miscellaneous' }), ctx())).toBe('review');
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

  /** Ids in ranked order, and the ids that were demoted (which must be last, with score 0). */
  const rankedIds = (r: ReturnType<typeof buildDecisions>) => {
    const ids = r.decisions.map((d) => d.id);
    const demotedIds = r.demoted;
    expect(ids.slice(ids.length - demotedIds.length)).toEqual(demotedIds);
    for (const d of r.decisions) if (demotedIds.includes(d.id)) expect(d.score).toBe(0);
    return { ids, demotedIds };
  };

  it('(round 2) Spelling flags of the same word batch into one decision, whatever the suggestions', () => {
    const a = cand({ original: 'talukas', replacements: ['talks', 'talus'] });
    const b = cand({ paraId: 1, original: 'talukas', replacements: ['tasks'] });
    const c = cand({ paraId: 4, original: 'talukas', replacements: [] });
    const other = cand({ paraId: 2, original: 'siltation', replacements: ['salvation', 'situation'] });
    const all = [a, b, other, c];
    const { decisions } = buildDecisions(all, new Map(all.map((x) => [x.id, 'review' as Tier])));
    expect(decisions.map((d) => d.candidateIds)).toEqual([[a.id, b.id, c.id], [other.id]]);
    expect(decisions[0]).toMatchObject({ kind: 'batch', id: 'batch:word:Spelling:talukas', label: 'talukas → talks / talus (3 places)' });
  });

  it('(round 2) the identical flag repeated (same kind, original and message) is one decision', () => {
    const msg = { kind: 'Regionalism', replacements: [], message: "`coriander` isn't used in Indian English." };
    const a = cand({ ...msg, original: 'coriander' });
    const b = cand({ ...msg, paraId: 3, original: 'Coriander' });
    const otherMsg = cand({ ...msg, paraId: 5, original: 'coriander', message: 'Something else.' });
    const all = [a, b, otherMsg];
    const { decisions } = buildDecisions(all, new Map(all.map((x) => [x.id, 'review' as Tier])));
    expect(decisions.map((d) => d.candidateIds)).toEqual([[a.id, b.id], [otherMsg.id]]);
  });

  it('(4) capitalised flags go on the names card whether fact-locked or not (spec §5)', () => {
    const text = 'Marathwada is dry. Rain in Marathwada fell.';
    const locked = findLockedSpans(text);
    const first = cand({ original: 'Marathwada', span: { start: 0, end: 10 }, replacements: ['Maratha', "Maratha's"] });
    const second = cand({ original: 'Marathwada', span: { start: 27, end: 37 }, replacements: ['Maratha', "Maratha's"] });
    const teh = cand({ original: 'Teh', span: { start: 0, end: 3 }, paraId: 1, replacements: ['The', 'Tech'] });
    const all = [first, second, teh];
    const r = buildDecisions(all, new Map(all.map((c) => [c.id, 'review' as Tier])), { fold: (c) => c.paraId === 0 && foldsUnderMore(c, locked) });
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ kind: 'names', candidateIds: [first.id, second.id, teh.id], label: '2 names and places' });
  });

  it('(4) a demoted candidate still fills an empty ranking (any candidate on a fact-locked span)', () => {
    const text = 'See pages 41-48 now.';
    const locked = findLockedSpans(text);
    const dash = cand({ original: '-', span: { start: 12, end: 13 }, replacements: ['–'], kind: 'Formatting' });
    const { ids, demotedIds } = rankedIds(buildDecisions([dash], new Map([[dash.id, 'review']]), { fold: (c) => foldsUnderMore(c, locked) }));
    expect(ids).toEqual([dash.id]);
    expect(demotedIds).toEqual([dash.id]);
  });

  it('(4) the names card ranks after a sentence-initial misspelling', () => {
    const text = 'Recieve it. We met Anjali today.';
    const locked = findLockedSpans(text);
    const name = cand({ original: 'Anjali', span: { start: 19, end: 25 }, replacements: ['Alkali', 'Anal'] });
    const typo = cand({ original: 'Recieve', span: { start: 0, end: 7 }, replacements: ['Receive', 'Relieve'] });
    const fold = (c: Candidate) => foldsUnderMore(c, locked);
    const tiers = new Map<string, Tier>([[typo.id, 'review'], [name.id, 'review']]);
    const { decisions } = buildDecisions([name, typo], tiers, { fold, paraText: new Map([[0, text]]) });
    expect(decisions.map((d) => d.id)).toEqual([typo.id, 'names']);
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

  it('candidates with a choice batch only as the identical flag (same original and message)', () => {
    const cs = [0, 1].map((p) => cand({ paraId: p, original: 'Its', replacements: ["It's", 'It has'], kind: 'Miscellaneous' }));
    const other = cand({ paraId: 2, original: 'Its', replacements: ["It's", 'It has'], kind: 'Miscellaneous', message: 'other' });
    const { decisions } = buildDecisions([...cs, other], tiersOf([...cs, other], 'review'));
    expect(decisions.map((d) => d.kind)).toEqual(['batch', 'single']);
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
    const c = ctx({ locked: new Map([[0, findLockedSpans(text)]]), paraText: new Map([[0, text]]) });
    const by = (o: string) => cs.find((x) => x.original === o)!;
    expect(tierOf(by('teh'), c)).toBe('safe');
    expect(tierOf(by('Sujit'), c)).toBe('review');
    expect(tierOf(by('a'), c)).toBe('safe');
  });
});

describe('Oxford comma', () => {
  const oxford = cand({ original: 'sugar', replacements: ['sugar,'], kind: 'Style', message: 'An Oxford comma is necessary here.' });
  it.each([
    ['British', 'hidden'],
    ['Indian', 'hidden'],
    ['American', 'review'],
  ] as const)('under %s is %s', (variant, tier) => {
    expect(tierOf(oxford, ctx({ variant }))).toBe(tier);
  });

  it('other Style candidates are unaffected', () => {
    const other = cand({ original: 'very', replacements: [''], kind: 'Style', message: 'Avoid intensifiers.' });
    expect(tierOf(other, ctx({ variant: 'British' }))).toBe('review');
  });
});

describe('names card (spec §5)', () => {
  const review = (cs: Candidate[]) => new Map(cs.map((c) => [c.id, 'review' as Tier]));
  const rao1 = cand({ original: 'Rao', replacements: ['Rad', 'Rag'] });
  const rao2 = cand({ paraId: 1, original: 'Rao', replacements: ['Rad', 'Rag'] });
  const kulkarni = cand({ paraId: 2, original: 'Kulkarni', replacements: ['Bulgari'] });
  const word = cand({ paraId: 3, original: 'talukas', replacements: ['talks', 'talus'] });
  const agr = cand({ paraId: 4, original: 'has', replacements: ['have'], kind: 'Agreement' });

  it('all capitalised Spelling/Typo flags form one names decision, ranked last', () => {
    const all = [rao1, word, kulkarni, agr, rao2];
    const { decisions } = buildDecisions(all, review(all));
    const last = decisions.at(-1)!;
    expect(last).toEqual({
      id: 'names',
      kind: 'names',
      candidateIds: [rao1.id, kulkarni.id, rao2.id],
      label: '2 names and places',
      score: 0,
      nearDuplicates: [],
    });
    expect(decisions.filter((d) => d.kind === 'names')).toHaveLength(1);
    expect(decisions).toHaveLength(3);
  });

  it('words marked as typos leave the card and get their own ranked decision', () => {
    const all = [rao1, kulkarni, rao2, agr];
    const { decisions } = buildDecisions(all, review(all), { typoWords: new Set(['kulkarni']) });
    const names = decisions.find((d) => d.kind === 'names')!;
    expect(names.candidateIds).toEqual([rao1.id, rao2.id]);
    expect(names.label).toBe('1 name or place');
    const typo = decisions.find((d) => d.candidateIds.includes(kulkarni.id))!;
    expect(typo.kind).toBe('single');
    expect(typo.score).toBeGreaterThan(0);
  });

  it('typoWords only affects Spelling/Typo flags: another kind on a fact-locked span stays demoted', () => {
    const agrRao = cand({ paraId: 5, original: 'Rao', replacements: ['Raos'], kind: 'Agreement' });
    const r = buildDecisions([agrRao], review([agrRao]), { fold: () => true, typoWords: new Set(['rao']) });
    expect(r.demoted).toEqual([agrRao.id]);
    expect(r.decisions[0].score).toBe(0);
  });

  /** "Teh dog ran. Goverment staff met Pirya and Priya." as Harper flags it. */
  const text = 'Teh dog ran. Goverment staff met Pirya and Priya.';
  const teh = cand({ original: 'Teh', span: { start: 0, end: 3 }, replacements: ['The', 'Tech'] });
  const goverment = cand({ original: 'Goverment', span: { start: 13, end: 22 }, replacements: ['Government'] });
  const pirya = cand({ original: 'Pirya', span: { start: 33, end: 38 }, replacements: ['Pirate'] });
  const priya = cand({ original: 'Priya', span: { start: 43, end: 48 }, replacements: ['Pria'] });
  const paraText = new Map([[0, text]]);

  it('a sentence-initial capitalised word with a one-letter fix, never capitalised mid-sentence, is a likely typo', () => {
    const all = [teh, goverment, pirya, priya];
    const { decisions } = buildDecisions(all, review(all), { paraText });
    expect(decisions.map((d) => d.id)).toEqual([teh.id, goverment.id, 'names']);
    expect(decisions[0]).toMatchObject({ kind: 'single', label: 'Teh → The / Tech' });
    expect(decisions[0].score).toBeGreaterThan(0);
    expect(decisions[2]).toMatchObject({ candidateIds: [pirya.id, priya.id], nearDuplicates: [['Pirya', 'Priya']] });
  });

  it('likely typos of the same word batch into one decision', () => {
    const t = 'Teh dog ran. Teh cat sat.';
    const a = cand({ original: 'Teh', span: { start: 0, end: 3 }, replacements: ['The'] });
    const b = cand({ original: 'Teh', span: { start: 13, end: 16 }, replacements: ['The'] });
    const { decisions } = buildDecisions([a, b], review([a, b]), { paraText: new Map([[0, t]]) });
    expect(decisions).toEqual([expect.objectContaining({ kind: 'batch', candidateIds: [a.id, b.id] })]);
  });

  it.each([
    ['used capitalised mid-sentence elsewhere', 'Rao left. We met Rao.', 'Rao', ['Rad']],
    ['no one-letter fix', 'Kalsubai is high.', 'Kalsubai', ['Kalahari']],
    ['not at a sentence start', 'We met Raoo today.', 'Raoo', ['Rao']],
    // all capitals is not a sentence-start capital: an acronym or a script's speaker label
    ['written in capitals', 'NPCI runs UPI.', 'NPCI', ['NPC']],
    ['a speaker label in capitals', 'MEGHNA: Welcome back.', 'MEGHNA', ['Meghan']],
  ])('stays on the names card when %s', (_why, t, word, replacements) => {
    const c = cand({ original: word, span: { start: t.indexOf(word), end: t.indexOf(word) + word.length }, replacements });
    const { decisions } = buildDecisions([c], review([c]), { paraText: new Map([[0, t]]) });
    expect(decisions.map((d) => d.kind)).toEqual(['names']);
  });

  it('nearDuplicates skips initials, acronyms and plurals (A./R., CGST/SGST, WUA/WUAs)', () => {
    const words = ['A.', 'R.', 'CGST', 'SGST', 'WUA', 'WUAs', 'Pirya', 'Priya'];
    const cs = words.map((original, i) => cand({ paraId: 10 + i, original, replacements: [] }));
    const { decisions } = buildDecisions(cs, review(cs));
    expect(decisions[0].nearDuplicates).toEqual([['Pirya', 'Priya']]);
  });

  it('after a sentence end and an opening quote, a word is still at a sentence start', () => {
    const t = 'He spoke. "Goverment plans';
    const c = cand({ original: 'Goverment', span: { start: 11, end: 20 }, replacements: ['Government'] });
    const { decisions } = buildDecisions([c], review([c]), { paraText: new Map([[0, t]]) });
    expect(decisions.map((d) => d.kind)).toEqual(['single']);
  });

  it('blocked name flags join the one names card; other blocked candidates are returned apart', () => {
    const blockedName = cand({ paraId: 6, original: 'Nashik', replacements: ['Nasik'] });
    const blockedAgr = cand({ paraId: 6, original: 'have', replacements: ['has'], kind: 'Agreement' });
    const all = [rao1, blockedName, blockedAgr, agr];
    const isBlocked = (c: Candidate) => c.paraId === 6;
    const r = buildDecisions(all, review(all), { blocked: isBlocked });
    expect(r.decisions.map((d) => d.id)).toEqual([agr.id, 'names']);
    expect(r.decisions[1].candidateIds).toEqual([rao1.id, blockedName.id]);
    expect(r.blocked.map((d) => d.id)).toEqual([blockedAgr.id]);
  });
});

describe('heading title case (spec §2: no nagging about house style)', () => {
  const heading = cand({
    original: '## The flat and the numbers',
    replacements: ['## The Flat and the Numbers'],
    kind: 'Capitalization',
    message: 'Try to use title case in headings.',
  });
  it.each(['academic', 'blog', 'script', 'business'] as const)('is hidden by default under %s', (p) => {
    expect(tierOf(heading, ctx({ preset: PRESETS[p] }))).toBe('hidden');
  });
  it('a user tier override for Capitalization brings it back', () => {
    expect(tierOf(heading, ctx({ userTierOverrides: { Capitalization: 'review' } }))).toBe('review');
  });
  it('other Capitalization fixes are unaffected', () => {
    expect(tierOf(cand({ original: 'i', replacements: ['I'], kind: 'Capitalization' }), ctx())).toBe('safe');
  });
});
