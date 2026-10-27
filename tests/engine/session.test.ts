import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { exportReport } from '@/engine/report';
import { carryDecisions, userDecisions } from '@/engine/carryDecisions';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { Candidate, Paragraph } from '@/engine/types';

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

const start = (paras: Paragraph[], over: Partial<CheckOptions> = {}, now?: () => Date) =>
  CheckSession.start(paras, opts(over), { linter, now });

const byOriginal = (s: CheckSession, original: string, paraId = 0) =>
  s.candidates().find((c) => c.original === original && c.paraId === paraId)!;

const lastLog = (s: CheckSession, id: string) => s.log().filter((e) => e.candidateId === id).at(-1);

// "of of" is a doubling that is always a slip, so it is a simple fix ("is is" can be grammar: "What it is is…").
const TEH = 'I think teh cat of of mine is here.';
const TEH_FIXED = 'I think the cat of mine is here.';

/** A check whose simple-fixes card the user then applied with one click (Task F4: nothing changes a word unasked). */
const startFixed = async (paras: Paragraph[], over: Partial<CheckOptions> = {}, now?: () => Date) => {
  const s = await start(paras, over, now);
  s.applyBatch(SIMPLE_FIXES_ID);
  return s;
};

describe('CheckSession.start', () => {
  it('ranks spelling suggestions by likelihood and never offers an offensive word (spec §5)', async () => {
    const s = await start([{ id: 0, text: 'The recods were filed. Sujit arived late.' }]);
    expect(byOriginal(s, 'recods').replacements[0]).toBe('records');
    expect(byOriginal(s, 'Sujit').replacements).not.toContain('Shit');
    const arived = byOriginal(s, 'arived');
    expect(arived.replacements[0]).toBe('arrived');
    expect(s.tier(arived.id)).toBe('review');
  });

  it('puts safe word fixes on the simple-fixes card, applied with one click and logged as accepted (Task F4)', async () => {
    const s = await start([{ id: 0, text: TEH }]);
    const teh = byOriginal(s, 'teh');
    const ofof = byOriginal(s, 'of of');
    expect([s.tier(teh.id), s.tier(ofof.id)]).toEqual(['batch', 'batch']);
    expect(s.log()).toEqual([]);
    s.applyBatch(SIMPLE_FIXES_ID);
    for (const c of [teh, ofof]) {
      const e = lastLog(s, c.id)!;
      expect(e.status).toBe('applied');
      expect(e.auto).toBe(false);
    }
  });

  it('a doubling before a word it starts is reviewed, not deleted: "for for-profit" (F3 re-review, D1)', async () => {
    // The linter flags these only after a paragraph's first sentence.
    const text = "It rained. He worked for for-profit colleges. Invest with with-profits funds. We went to to's house.";
    const s = await start([{ id: 0, text }], { tierOverrides: { WordChoice: 'safe' } });
    expect(byOriginal(s, 'for for').kind).toBe('Repetition');
    expect(s.outcomes().filter((o) => o.auto)).toEqual([]);
    expect(s.outputText(0)).toBe(text);
  });

  it('outputText applies the fixes', async () => {
    const s = await startFixed([{ id: 0, text: TEH }]);
    expect(s.outputText(0)).toBe(TEH_FIXED);
  });

  it('uses the given variant without detection, and the injected clock', async () => {
    const at = new Date('2026-10-20T10:00:00.000Z');
    const s = await startFixed([{ id: 0, text: TEH }], { variant: 'British' }, () => at);
    expect(s.variant).toBe('British');
    expect(s.mixedVariant).toBe(false);
    expect(s.log()[0].at).toBe(at.toISOString());
  });

  it('detects the variant when none is given', async () => {
    const s = await start([{ id: 0, text: 'The colour of the organised behaviour.' }], { variant: undefined });
    expect(s.variant).not.toBe('American');
  });
});

describe('decisions, accept, undo', () => {
  const paras = [{ id: 0, text: "I can't go. You can't stay." }];

  it('accepting a batch applies all of its candidates; undo restores only one', async () => {
    const s = await start(paras, { preset: 'academic' });
    const batch = s.decisions().top.find((d) => d.kind === 'batch')!;
    expect(batch.candidateIds).toHaveLength(2);
    s.accept(batch.id);
    expect(s.outputText(0)).toBe('I cannot go. You cannot stay.');

    const [first, second] = batch.candidateIds;
    s.undo(second);
    expect(s.outputText(0)).toBe("I cannot go. You can't stay.");
    expect(lastLog(s, second)!.status).toBe('rejected');
    expect(lastLog(s, first)!.status).toBe('applied');

    // rejected (by user) → pending: it comes back as a single decision
    s.undo(second);
    expect(lastLog(s, second)!.status).toBe('pending');
    expect(s.decisions().top.map((d) => d.id)).toContain(second);
  });

  it('applyBatch applies the chosen members as one batch; undoBatch takes them all back in one step', async () => {
    const s = await start([{ id: 0, text: "I can't go. You can't stay. We can't eat." }], { preset: 'academic' });
    const batch = s.decisions().top.find((d) => d.kind === 'batch')!;
    const [a, b, c] = batch.candidateIds;
    const batchId = s.applyBatch(batch.id, [a, c]);
    expect(s.outputText(0)).toBe("I cannot go. You can't stay. We cannot eat.");
    const inBatch = s.outcomes().filter((o) => o.batch === batchId).map((o) => o.candidate.id);
    expect(inBatch).toEqual([a, c]);
    // The unchosen member stays for review.
    expect(s.decisions().top.map((d) => d.id)).toContain(b);

    s.undoBatch(batchId);
    expect(s.outputText(0)).toBe("I can't go. You can't stay. We can't eat.");
    expect([lastLog(s, a)!.status, lastLog(s, c)!.status]).toEqual(['rejected', 'rejected']);
  });

  it('applyBatch without a list applies every member; a member of another decision is refused', async () => {
    const s = await start([{ id: 0, text: "I can't go. You can't stay. I think teh cat is here." }], { preset: 'academic' });
    const batch = s.decisions().top.find((d) => d.kind === 'batch' && d.id !== SIMPLE_FIXES_ID)!;
    expect(() => s.applyBatch(batch.id, ['not-a-member'])).toThrow(/not part of/);
    expect(() => s.applyBatch(batch.id, [])).toThrow(/at least one/);
    s.applyBatch(batch.id);
    expect(s.outputText(0)).toBe('I cannot go. You cannot stay. I think teh cat is here.');
    expect(() => s.undoBatch('batch-99')).toThrow(/unknown batch/);
  });

  it('applyBatch refuses the names card like accept does (spec §5: cards are never answered by index)', async () => {
    const s = await start([{ id: 0, text: 'We met Anjali Kulkarni in Nashik today.' }]);
    const card = [...s.decisions().top, ...s.decisions().more].find((d) => d.kind === 'names')!;
    expect(() => s.applyBatch(card.id)).toThrow(/answered with acceptNames/);
    expect(s.outcomes().every((o) => o.status === 'pending')).toBe(true);
  });

  it('ignoredRules hides every flag of those kinds', async () => {
    const shown = await start(paras, { preset: 'academic' });
    expect(shown.decisionCount()).toBe(1);
    const ignored = await start(paras, { preset: 'academic', ignoredRules: ['Contraction'] });
    expect(ignored.decisionCount()).toBe(0);
  });

  it("accept uses each candidate's own replacement at the index", async () => {
    const s = await start([{ id: 0, text: "It's late. it's cold." }], { preset: 'academic' });
    const ids = s.decisions().top.flatMap((d) => d.candidateIds);
    for (const d of s.decisions().top) s.accept(d.id, 1);
    expect(ids.length).toBe(2);
    expect(s.outputText(0)).toBe('It has late. it has cold.');
  });

  it('a newer accept over an applied edit supersedes the older one', async () => {
    const s = await startFixed([{ id: 0, text: TEH }]);
    const teh = byOriginal(s, 'teh');
    const llm: Candidate = {
      id: 'llm:1',
      paraId: 0,
      span: { start: 0, end: 15 },
      original: 'I think teh cat',
      replacements: ['I believe the cat'],
      kind: 'Rewrite',
      message: 'Rewrite',
      source: 'llm',
    };
    s.addCandidates([llm]);
    expect(s.tier('llm:1')).toBe('review');
    s.accept('llm:1');
    expect(lastLog(s, teh.id)!.status).toBe('superseded');
    expect(s.outputText(0)).toBe('I believe the cat of mine is here.');

    const edits = s.acceptedEdits();
    for (let i = 1; i < edits.length; i++) {
      const [a, b] = [edits[i - 1], edits[i]];
      if (a.paraId === b.paraId) expect(a.span.end).toBeLessThanOrEqual(b.span.start);
    }
  });

  it('top holds at most 10 decisions', async () => {
    const text =
      "We can't, won't, don't and doesn't. It isn't, they aren't, he wasn't, we weren't. " +
      "I haven't, she hasn't, we hadn't, it wouldn't, you shouldn't, they couldn't, we mustn't.";
    const s = await start([{ id: 0, text }], { preset: 'academic' });
    const { top, more } = s.decisions();
    expect(top.length).toBeLessThanOrEqual(10);
    expect(top.length + more.length).toBeGreaterThan(10);
    expect(s.decisionCount()).toBe(top.length);
  });

  it('the names card ranks last but fills an empty top', async () => {
    const s = await start([{ id: 0, text: 'We met Anjali Kulkarni in Nashik today.' }]);
    const { top } = s.decisions();
    expect(top.map((d) => d.label)).toEqual(['3 names and places']);
    expect(top.every((d) => d.score === 0)).toBe(true);
    expect(s.rankedDecisionCount()).toBe(top.length);
  });

  it('real errors that are demoted are never hidden: an all-quote sentence still fills top', async () => {
    const s = await start([{ id: 0, text: 'He said, "I recieve teh money tommorow and it dont matter."' }]);
    expect(s.decisionCount()).toBeGreaterThan(0);
  });

  it('rankedDecisionCount counts top and more, but not tracked-change-locked candidates', async () => {
    const words = Array.from({ length: 14 }, (_, i) => `wrd${'q'.repeat(i)}x`).join(' ');
    const s = await start([{ id: 0, text: `${words} teh end`, locked: [{ start: 0, end: 4 }] }]);
    const { top, more } = s.decisions();
    const blocked = s.candidates().filter((c) => c.span.start < 4).length;
    expect(s.rankedDecisionCount()).toBe(top.length + more.length - blocked);
    expect(s.rankedDecisionCount()).toBeGreaterThan(s.decisionCount());
  });

  it('reject marks every pending member rejected', async () => {
    const s = await start(paras, { preset: 'academic' });
    const batch = s.decisions().top.find((d) => d.kind === 'batch')!;
    s.reject(batch.id);
    for (const id of batch.candidateIds) expect(lastLog(s, id)!.status).toBe('rejected');
    expect(s.decisions().top).toHaveLength(0);
    expect(s.outputText(0)).toBe(paras[0].text);
  });
});

describe('invisible characters (review #4, C3)', () => {
  it('the linter reads words without them, so nothing is fixed from the pieces', async () => {
    const s = await start([
      { id: 0, text: 'We saw a m\u{2060}ean value.' },
      { id: 1, text: 'We trained the mod\u{200B}els well.' },
    ]);
    expect(s.candidates().map((c) => c.kind)).toEqual(['Invisible', 'Invisible']);
    expect([s.outputText(0), s.outputText(1)]).toEqual(['We saw a mean value.', 'We trained the models well.']);
  });

  it('a flag on a word with one inside spans it in the paragraph, and is never auto-applied', async () => {
    const text = 'I think t\u{200B}eh cat sat.';
    const s = await start([{ id: 0, text }]);
    const teh = s.candidates().find((c) => c.kind === 'Typo')!;
    expect(teh).toMatchObject({ id: '0:8:12:Typo', span: { start: 8, end: 12 }, original: 't\u{200B}eh', replacements: ['the'] });
    expect(s.tier(teh.id)).toBe('review');
    s.accept(teh.id);
    expect(s.outputText(0)).toBe('I think the cat sat.');
  });

  it('one hygiene keeps never lets a flag next to it auto-apply (F3 re-review, D2)', async () => {
    const texts = ['We saw a m\u{200E}ean value.', 'We saw a m\u{2066}ean\u{2069} value.', 'We saw a m\u{FE0F}ean value.', 'Read the te\u{180B}xt.'];
    const s = await start(texts.map((text, id) => ({ id, text })));
    expect(s.outcomes().filter((o) => o.auto)).toEqual([]);
    expect(texts.map((_, id) => s.outputText(id))).toEqual(texts);
  });

  it('a direction pair with one end in a quote is left whole and reported (F3 re-review, D3)', async () => {
    const text = 'He said "\u{202E}sales" today\u{202C} and left. The total \u{202E}₹5,000\u{202C} is due.';
    const s = await start([{ id: 0, text }]);
    expect(s.outputText(0)).toBe('He said "\u{202E}sales" today\u{202C} and left. The total ₹5,000 is due.');
    const kept = s.candidates().filter((c) => c.kind === 'Invisible' && c.replacements.length === 0);
    expect(kept.map((c) => c.span.start)).toEqual([9, 22]);
    expect(kept.every((c) => s.tier(c.id) === 'review')).toBe(true);
  });

  it('flags after one keep their offsets in the paragraph', async () => {
    const text = '\u{200B}I think teh cat sat.';
    const s = await startFixed([{ id: 0, text }]);
    expect(s.candidates().find((c) => c.kind === 'Typo')).toMatchObject({ span: { start: 9, end: 12 }, original: 'teh' });
    expect(s.outputText(0)).toBe('I think the cat sat.');
  });
});

describe('supersede chain', () => {
  const rewrite: Candidate = {
    id: 'llm:1',
    paraId: 0,
    span: { start: 0, end: 15 },
    original: 'I think teh cat',
    replacements: ['I believe the cat'],
    kind: 'Rewrite',
    message: 'Rewrite',
    source: 'llm',
  };

  it('undoing the superseding edit restores the older one', async () => {
    const s = await startFixed([{ id: 0, text: TEH }]);
    const teh = byOriginal(s, 'teh');
    s.addCandidates([rewrite]);
    s.accept('llm:1');
    s.undo('llm:1');
    expect(lastLog(s, teh.id)!.status).toBe('applied');
    expect(s.outputText(0)).toBe(TEH_FIXED);
  });

  it('marking the superseding edit unplaceable restores the older one', async () => {
    const s = await startFixed([{ id: 0, text: TEH }]);
    const teh = byOriginal(s, 'teh');
    s.addCandidates([rewrite]);
    s.accept('llm:1');
    s.markUnplaceable('llm:1', 'run split');
    expect(lastLog(s, teh.id)!.status).toBe('applied');
    expect(s.outputText(0)).toBe(TEH_FIXED);
  });

  // Before Task F14 it came back pending and on offer, so applying it would have undone "llm:c" (final F13 review I-2).
  it('restored under another applied edit, it stays out of the review until that edit is undone too', async () => {
    const s = await startFixed([{ id: 0, text: TEH }]);
    const ofof = byOriginal(s, 'of of'); // 16..21, applied with the simple-fixes card
    const llm = (id: string, start: number, end: number, r: string): Candidate => ({
      ...rewrite,
      id,
      span: { start, end },
      original: TEH.slice(start, end),
      replacements: [r],
    });
    s.addCandidates([llm('llm:b', 16, 18, 'was'), llm('llm:c', 19, 21, 'here')]);
    s.accept('llm:b'); // supersedes "of of"
    s.accept('llm:c'); // overlaps "of of" only
    s.undo('llm:b');
    expect(lastLog(s, ofof.id)).toMatchObject({ status: 'superseded', reason: 'superseded by llm:c' });
    expect(s.decisions().top.flatMap((d) => d.candidateIds)).not.toContain(ofof.id);
    const edits = s.acceptedEdits();
    for (let i = 1; i < edits.length; i++) expect(edits[i - 1].span.end).toBeLessThanOrEqual(edits[i].span.start);
    s.undo('llm:c');
    expect(lastLog(s, ofof.id)).toMatchObject({ status: 'pending', reason: 'restored after llm:c was removed' });
    expect(s.decisions().top.flatMap((d) => d.candidateIds)).toContain(ofof.id);
  });
});

describe('explicit variant', () => {
  it('still computes variant words, so a single-suggestion variant spelling is not auto-applied', async () => {
    // Wrap the real linter so every rules candidate has exactly one replacement.
    const single: RulesLinter = {
      get variant() {
        return linter.variant;
      },
      lintParagraphs: async (p, lang) =>
        (await linter.lintParagraphs(p, lang)).map((c) => ({ ...c, replacements: c.replacements.slice(0, 1) })),
      lintSpelling: (p, v) => linter.lintSpelling(p, v),
      addWords: (w) => linter.addWords(w),
      setVariant: (v) => linter.setVariant(v),
    };
    const s = await CheckSession.start([{ id: 0, text: 'The colour is nice.' }], opts({ variant: 'American' }), {
      linter: single,
    });
    const colour = byOriginal(s, 'colour');
    expect(colour.replacements).toEqual(['color']);
    expect(s.tier(colour.id)).toBe('review');
    expect(s.outputText(0)).toBe('The colour is nice.');
    expect(s.mixedVariant).toBe(true);
  });
});

describe('adapter-locked spans', () => {
  it('makes overlapping candidates review-only and accept leaves them pending', async () => {
    const s = await start([{ id: 0, text: 'I think teh cat is here.', locked: [{ start: 8, end: 11 }] }]);
    const teh = byOriginal(s, 'teh');
    expect(s.tier(teh.id)).toBe('review');
    const { top, more } = s.decisions();
    expect(top.flatMap((d) => d.candidateIds)).not.toContain(teh.id);
    expect(more.map((d) => d.id)).toContain(teh.id);
    expect(s.outcomes().find((o) => o.candidate.id === teh.id)!.reason).toBe('inside an existing tracked change');
    s.accept(teh.id);
    const e = lastLog(s, teh.id)!;
    expect(e.status).toBe('pending');
    expect(e.reason).toBe('inside an existing tracked change');
    expect(s.outputText(0)).toBe('I think teh cat is here.');
    expect(s.acceptedEdits()).toHaveLength(0);
  });
});

describe('exportReport', () => {
  it('lists applied, rejected and unplaceable entries with before/after and paragraph number', async () => {
    const s = await start(
      [
        { id: 0, text: TEH },
        { id: 1, text: "I can't go." },
        { id: 2, text: 'Use a|b here.' },
        { id: 3, text: 'We went  home.' },
      ],
      { preset: 'academic' },
    );
    s.applyBatch(SIMPLE_FIXES_ID);
    const teh = byOriginal(s, 'teh');
    s.markUnplaceable(teh.id, 'run split across a hyperlink');
    const cant = byOriginal(s, "can't", 1);
    s.reject(cant.id);
    s.addCandidates([
      {
        id: 'llm:pipe',
        paraId: 2,
        span: { start: 4, end: 7 },
        original: 'a|b',
        replacements: ['a or b'],
        kind: 'Rewrite',
        message: 'clarify',
        source: 'llm',
      },
    ]);
    s.accept('llm:pipe');

    const md = exportReport(s, 'essay.docx');
    expect(md).toContain('essay.docx');
    expect(md).toContain('American');
    const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| #'));
    const row = (needle: string) => rows.find((r) => r.includes(needle))!;

    expect(row('of of')).toMatch(/\| 1 \| of of \| of \| Repetition \| accepted \|/);
    expect(row('Formatting')).toMatch(/\| 4 \| {4}\| {3}\| Formatting \| auto \|/);
    expect(row('teh')).toMatch(/\| 1 \| teh \| the \| Typo \| unplaceable: run split across a hyperlink \|/);
    expect(row("can't")).toMatch(/\| 2 \| can't \| cannot \| Contraction \| rejected \|/);
    expect(row('a or b')).toMatch(/\| 3 \| a\\\|b \| a or b \| Rewrite \| accepted \|/);
    expect(md).toMatch(/auto\D*1/i);
    expect(md).toMatch(/unplaceable\D*1/i);
  });

  it('warns about mixed variants', async () => {
    const s = await start([{ id: 0, text: 'The colour and the flavour of the color.' }], { variant: undefined });
    expect(s.variant).toBe('British');
    expect(s.mixedVariant).toBe(true);
    expect(exportReport(s, 'x.md')).toMatch(/mixed/i);
  });

  it('shows the replacement the user chose, even after undo', async () => {
    const s = await start([{ id: 0, text: "It's late." }], { preset: 'academic' });
    const c = byOriginal(s, "It's");
    s.accept(c.id, 1);
    expect(lastLog(s, c.id)!.replacement).toBe('It has');
    s.undo(c.id);
    expect(lastLog(s, c.id)!.replacement).toBe('It has');
    expect(s.outcomes().find((o) => o.candidate.id === c.id)!.replacement).toBe('It has');
    expect(exportReport(s, 'x.md')).toMatch(/\| It's \| It has \| Contraction \| rejected \|/);
  });
});

// The < 300 ms timing test lives in tests/timing (run on its own, after the rest of the suite).

describe('word batches (round 2)', () => {
  const word = (id: string, paraId: number, original: string, replacements: string[]): Candidate => ({
    id,
    paraId,
    span: { start: 0, end: original.length },
    original,
    replacements,
    kind: 'Spelling',
    message: 'm',
    source: 'rules',
  });
  const paras3 = [0, 1, 2].map((id) => ({ id, text: 'word is here.' }));
  const batchOf = (s: CheckSession, id: string) => [...s.decisions().top, ...s.decisions().more].find((d) => d.candidateIds.includes(id))!;

  it('accept(batch, i) applies each member its own replacement when they share the text', async () => {
    const s = await start(paras3);
    s.addCandidates([word('a', 0, 'word', ['ward', 'wired']), word('b', 1, 'word', ['Ward', 'Wired'])]);
    const d = batchOf(s, 'a');
    expect(d.kind).toBe('batch');
    s.accept(d.id, 1);
    expect(s.outputText(0)).toBe('wired is here.');
    expect(s.outputText(1)).toBe('Wired is here.');
  });

  it('accept(batch, i) is rejected with a clear error when members differ at i, and applies nothing', async () => {
    const s = await start(paras3);
    s.addCandidates([word('a', 0, 'word', ['ward', 'wired']), word('b', 1, 'word', ['wad', 'wired'])]);
    const d = batchOf(s, 'a');
    expect(() => s.accept(d.id, 0)).toThrow(/different replacements/);
    expect(s.acceptedEdits()).toEqual([]);
    s.accept(d.id, 1); // shared at index 1
    expect(s.acceptedEdits()).toHaveLength(2);
  });

  it('ignoreAll rejects every member', async () => {
    const s = await start(paras3);
    s.addCandidates([word('a', 0, 'word', ['ward', 'wad']), word('b', 1, 'word', ['ward', 'wired'])]);
    const d = batchOf(s, 'a');
    s.ignoreAll(d.id);
    for (const id of ['a', 'b']) expect(lastLog(s, id)!.status).toBe('rejected');
    expect(batchOf(s, 'a')).toBeUndefined();
  });

  it('addToDictionary adds the word, rejects the batch and drops the same word pending elsewhere', async () => {
    // Own linter: the word is added to it.
    const paras = [
      { id: 0, text: 'Sujit met us. Later Sujit left.' },
      { id: 1, text: 'Ask Sujit now.', locked: [{ start: 4, end: 9 }] },
    ];
    const s = await CheckSession.start(paras, opts());
    const sujit = s.candidates().filter((c) => c.original === 'Sujit');
    expect(sujit).toHaveLength(3);
    const d = batchOf(s, sujit[0].id);
    await s.addToDictionary(d.id);
    for (const c of sujit) expect(lastLog(s, c.id)!.status).toBe('rejected');
    expect(lastLog(s, sujit[2].id)!.reason).toMatch(/dictionary/);
    expect(s.addedWords()).toEqual(['Sujit']);
    expect(s.rankedDecisionCount()).toBe(0);
  });

  it('addToDictionary refuses decisions that are not about a word', async () => {
    const s = await start([{ id: 0, text: TEH }]);
    s.addCandidates([{ ...word('x', 0, 'is is', ['is']), kind: 'Repetition' }]);
    await expect(s.addToDictionary('x')).rejects.toThrow(/not a word/);
  });
});

describe('names card in a session', () => {
  const text = 'We met Anjali, Kulkarni and Rao in Nashik. Later Rao left.';

  it('counts as one ranked decision', async () => {
    const s = await start([{ id: 0, text }]);
    const names = s.decisions().top.filter((d) => d.kind === 'names');
    expect(names).toHaveLength(1);
    expect(names[0].label).toBe('4 names and places');
    expect(s.rankedDecisionCount()).toBe(1);
  });

  it('acceptNames adds every name to the dictionary except the typos, which split out', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts()); // own linter: words are added to it
    await s.acceptNames(['nashik']);
    expect(s.addedWords().sort()).toEqual(['Anjali', 'Kulkarni', 'Rao']);
    const left = [...s.decisions().top, ...s.decisions().more];
    expect(left.map((d) => d.kind)).not.toContain('names');
    const nashik = left.find((d) => d.label.startsWith('Nashik'))!;
    expect(nashik.kind).toBe('single');
    for (const c of s.candidates().filter((x) => x.original === 'Rao')) {
      expect(lastLog(s, c.id)!.reason).toMatch(/dictionary/);
    }
    expect(s.rankedDecisionCount()).toBe(1);
  });

  it('sentence-initial typos are ranked decisions; near-duplicate names are flagged on the card', async () => {
    const s = await start([{ id: 0, text: 'Teh dog ran. Goverment staff met Pirya and Priya.' }]);
    const { top } = s.decisions();
    expect(top.map((d) => d.label.split(' ')[0])).toEqual(['Teh', 'Goverment', '2']);
    expect(top.slice(0, 2).every((d) => d.kind === 'single' && d.score > 0)).toBe(true);
    const card = top[2];
    expect(card.candidateIds.map((id) => s.candidates().find((c) => c.id === id)!.original)).toEqual(['Pirya', 'Priya']);
    expect(card.nearDuplicates).toEqual([['Pirya', 'Priya']]);
  });

  it('accept refuses the names card (it is answered with acceptNames)', async () => {
    const s = await start([{ id: 0, text }]);
    expect(() => s.accept('names', 0)).toThrow(/acceptNames/);
    expect(s.acceptedEdits()).toEqual([]);
  });

  it('a re-check offers a name accepted earlier as a word on the names card again, never replaying the replacement (review #4, C2)', async () => {
    const paras = [{ id: 0, text: 'We met Anjali today.' }];
    const before = await start(paras, { modules: { namesCard: false } });
    const anjali = byOriginal(before, 'Anjali');
    before.accept(anjali.id, 0);
    expect(before.outputText(0)).not.toBe(paras[0].text);
    const after = await start(paras);
    expect(after.onWordCard(byOriginal(after, 'Anjali').id)).toBe(true);
    carryDecisions(userDecisions(before), after, new Map([[0, 0]]));
    expect(after.outputText(0)).toBe(paras[0].text);
    expect(after.outcomes().find((o) => o.candidate.original === 'Anjali')!.status).toBe('pending');
  });

  it('accept and applyBatch refuse one card member by its own id too (review #4, C2)', async () => {
    const s = await start([{ id: 0, text }, { id: 1, text: 'We ate ukadiche modak at home.' }]);
    const { top, more } = s.decisions();
    const names = [...top, ...more].find((d) => d.kind === 'names')!;
    const indian = [...top, ...more].find((d) => d.kind === 'otherLanguage')!;
    for (const id of [names.candidateIds[0], indian.candidateIds[0]]) {
      expect(s.onWordCard(id)).toBe(true);
      expect(() => s.accept(id, 0)).toThrow(/is answered with accept(Names|OtherLanguage)/);
      expect(() => s.applyBatch(id)).toThrow(/is answered with accept(Names|OtherLanguage)/);
    }
    expect(s.acceptedEdits()).toEqual([]);
  });

  it('there is one names card, even with names inside a tracked change, and it is counted', async () => {
    const paras = [
      { id: 0, text },
      { id: 1, text: 'Ask Sujit now.', locked: [{ start: 4, end: 9 }] },
    ];
    const s = await start(paras);
    const { top, more } = s.decisions();
    const ids = [...top, ...more].map((d) => d.id);
    expect(ids.filter((id) => id === 'names')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(top.find((d) => d.id === 'names')!.label).toBe('5 names and places');
    expect(s.rankedDecisionCount()).toBe(1);
  });
});
