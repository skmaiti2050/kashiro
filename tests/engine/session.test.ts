import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { exportReport } from '@/engine/report';
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

const TEH = 'I think teh cat is is here.';

describe('CheckSession.start', () => {
  it('auto-applies safe candidates and logs them as auto', async () => {
    const s = await start([{ id: 0, text: TEH }]);
    const teh = byOriginal(s, 'teh');
    const isis = byOriginal(s, 'is is');
    expect(s.tier(teh.id)).toBe('safe');
    for (const c of [teh, isis]) {
      const e = lastLog(s, c.id)!;
      expect(e.status).toBe('applied');
      expect(e.auto).toBe(true);
    }
  });

  it('outputText applies the fixes', async () => {
    const s = await start([{ id: 0, text: TEH }]);
    expect(s.outputText(0)).toBe('I think the cat is here.');
  });

  it('uses the given variant without detection, and the injected clock', async () => {
    const at = new Date('2026-10-20T10:00:00.000Z');
    const s = await start([{ id: 0, text: TEH }], { variant: 'British' }, () => at);
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

  it("accept uses each candidate's own replacement at the index", async () => {
    const s = await start([{ id: 0, text: "It's late. it's cold." }], { preset: 'academic' });
    const ids = s.decisions().top.flatMap((d) => d.candidateIds);
    for (const d of s.decisions().top) s.accept(d.id, 1);
    expect(ids.length).toBe(2);
    expect(s.outputText(0)).toBe('It has late. it has cold.');
  });

  it('a newer accept over an applied edit supersedes the older one', async () => {
    const s = await start([{ id: 0, text: TEH }]);
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
    expect(s.outputText(0)).toBe('I believe the cat is here.');

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

  it('reject marks every pending member rejected', async () => {
    const s = await start(paras, { preset: 'academic' });
    const batch = s.decisions().top.find((d) => d.kind === 'batch')!;
    s.reject(batch.id);
    for (const id of batch.candidateIds) expect(lastLog(s, id)!.status).toBe('rejected');
    expect(s.decisions().top).toHaveLength(0);
    expect(s.outputText(0)).toBe(paras[0].text);
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
    const s = await start([{ id: 0, text: TEH }]);
    const teh = byOriginal(s, 'teh');
    s.addCandidates([rewrite]);
    s.accept('llm:1');
    s.undo('llm:1');
    expect(lastLog(s, teh.id)!.status).toBe('applied');
    expect(s.outputText(0)).toBe('I think the cat is here.');
  });

  it('marking the superseding edit unplaceable restores the older one', async () => {
    const s = await start([{ id: 0, text: TEH }]);
    const teh = byOriginal(s, 'teh');
    s.addCandidates([rewrite]);
    s.accept('llm:1');
    s.markUnplaceable('llm:1', 'run split');
    expect(lastLog(s, teh.id)!.status).toBe('applied');
    expect(s.outputText(0)).toBe('I think the cat is here.');
  });

  it('restores to pending when another applied edit now clashes', async () => {
    const s = await start([{ id: 0, text: TEH }]);
    const isis = byOriginal(s, 'is is'); // 16..21, auto-applied
    const llm = (id: string, start: number, end: number, r: string): Candidate => ({
      ...rewrite,
      id,
      span: { start, end },
      original: TEH.slice(start, end),
      replacements: [r],
    });
    s.addCandidates([llm('llm:b', 16, 18, 'was'), llm('llm:c', 19, 21, 'here')]);
    s.accept('llm:b'); // supersedes "is is"
    s.accept('llm:c'); // overlaps "is is" only
    s.undo('llm:b');
    expect(lastLog(s, isis.id)!.status).toBe('pending');
    expect(s.decisions().top.flatMap((d) => d.candidateIds)).toContain(isis.id);
    const edits = s.acceptedEdits();
    for (let i = 1; i < edits.length; i++) expect(edits[i - 1].span.end).toBeLessThanOrEqual(edits[i].span.start);
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
      ],
      { preset: 'academic' },
    );
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

    expect(row('is is')).toMatch(/\| 1 \| is is \| is \| Repetition \| auto \|/);
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

const PARAGRAPHS = [
  'The committee met on Tuesday to review the proposal for the new community library. Members discussed the budget, the timeline and the location, which has been a point of contention for several months. Some residents argued that the old post office building should be converted, while others preferred a new site closer to the school. After a long debate, the chair asked for a written report from each side before the next meeting.',
  'Our team has spent the last quarter improving the onboarding process for new customers. We interviewed twenty users, mapped every step they take in the first week, and found that most of them get stuck when connecting their bank account. The fix was simple: we moved the step later in the flow and added a short explanation of why it matters. Since the change, completion rates have risen steadily and support tickets have dropped.',
  'When I first moved to the city, I found it hard to make friends. Everyone seemed busy, and the neighbours rarely said more than a quick hello. Things changed when I joined a running club that met every Saturday morning near the river. Within a month I knew most of the regulars by name, and we often had breakfast together after the run. I still think it was the best decision I made that year.',
  'Climate scientists have long warned that rising temperatures will change rainfall patterns across the region. Farmers are already noticing that the monsoon arrives later and leaves earlier than it used to. Many have started planting different crops, investing in drip irrigation and storing water in small ponds. These changes cost money, however, and smaller farms often cannot afford them without help from the government or local cooperatives.',
  'The recipe looks complicated, but it is easier than it seems. Start by soaking the lentils overnight, then cook them slowly with onions, garlic and a little ginger. Add the tomatoes once the lentils are soft, and let everything simmer for another twenty minutes. Season with salt, cumin and fresh coriander just before serving. It tastes even better the next day, so make a large batch and keep the rest in the fridge.',
];

describe('performance', () => {
  it('a second start on ~1,500 words completes in < 300 ms', async () => {
    const paras: Paragraph[] = [];
    for (let r = 0; r < 4; r++) PARAGRAPHS.forEach((text) => paras.push({ id: paras.length, text }));
    const words = paras.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
    expect(words).toBeGreaterThanOrEqual(1400);

    const o = opts({ variant: undefined, fallbackVariant: 'British' });
    await CheckSession.start(paras, o, { linter }); // warm-up
    const t0 = performance.now();
    await CheckSession.start(paras, o, { linter });
    const ms = performance.now() - t0;
    console.log(`PERF second start: ${ms.toFixed(1)} ms for ${words} words`);
    expect(ms).toBeLessThan(300);
  });
});
