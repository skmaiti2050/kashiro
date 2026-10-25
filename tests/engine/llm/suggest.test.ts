import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { onlyPunctuationChanged, runBudget, suggestRewrites, type Rewriter } from '@/engine/llm/suggest';
import type { Candidate, Paragraph, Span } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

const start = (paras: Paragraph[]) =>
  CheckSession.start(paras, { preset: 'business', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [] }, { linter });

let seq = 0;
const styleLint = (paraId: number, span: Span): Candidate => ({
  id: `test:${seq++}`,
  paraId,
  span,
  original: 'x',
  replacements: [],
  kind: 'Style',
  message: 'Style',
  source: 'rules',
});

/** A helper that answers from a table (anything else: UNCHANGED) and records what it was sent. */
function recordedHelper(answers: Record<string, string>): Rewriter & { sent: string[]; variants: string[] } {
  const sent: string[] = [];
  const variants: string[] = [];
  return {
    sent,
    variants,
    async rewrite(text, _preset, variant) {
      sent.push(text);
      variants.push(variant);
      return answers[text] ?? null;
    },
  };
}

const live = () => new AbortController().signal;

const TEH = 'I think teh cat of of here. Attendance rose by 3.2% in districts that served hot meals.';
const FIRST = { start: 0, end: 27 };
const SECOND = { start: 28, end: TEH.length };

/** 756 words of clean filler (score 0, never picked): with TEH the budget is round(3 * 773 / 1500) = 2. */
const FILLER = 'The cat sat on the mat. '.repeat(126).trim();

async function tehSession() {
  const s = await start([{ id: 0, text: TEH }, { id: 1, text: FILLER }]);
  s.applyBatch(SIMPLE_FIXES_ID); // the user applies "teh" and "of of" with one click (Task F4)
  s.addCandidates([styleLint(0, { start: 0, end: 1 }), styleLint(0, { start: 28, end: 38 })]);
  return s;
}

describe('onlyPunctuationChanged', () => {
  it.each([
    ['Furniture, curtains, lights and small things added up.', 'Furniture, curtains, lights, and small things added up.'],
    ['In my first year I missed a deadline.', 'In my first year, I missed a deadline.'],
    ['It rose  by 3%.', 'It rose by 3% !'],
    // A typographic apostrophe is the same word as a straight one.
    ['The dog’s bowl was empty.', "The dog's bowl was empty."],
    ["It's late.", 'It’s late.'],
  ])('%j → %j: only punctuation or spaces', (original, rewrite) => {
    expect(onlyPunctuationChanged(original, rewrite)).toBe(true);
  });

  it.each([
    ['The room was hotter then the site.', 'The room was hotter than the site.'],
    ['The dog wagged its tail.', "The dog wagged it's tail."],
    ['We study 48 tanks.', 'The study examines 48 tanks.'],
    ['the plan was approved.', 'The plan was approved.'],
    // A Devanagari vowel sign (a combining mark) is part of the word: कि → का changes it.
    ['Maine kitab padhi: किताब कि.', 'Maine kitab padhi: किताब का.'],
    ['नमस्ते दोस्त.', 'नमस्ते दोस्ती.'],
  ])('%j → %j: a word changed', (original, rewrite) => {
    expect(onlyPunctuationChanged(original, rewrite)).toBe(false);
  });
});

describe('suggestRewrites', () => {
  it("sends the session's English variant, so the helper keeps the document's spelling and punctuation", async () => {
    const s = await tehSession();
    const helper = recordedHelper({});
    await suggestRewrites(s, helper, 'business', live());
    expect(helper.variants.length).toBeGreaterThan(0);
    expect(new Set(helper.variants)).toEqual(new Set([s.variant]));
  });

  it('drops a rewrite that only changes punctuation or spaces: not offered, not judged by the guard, counted', async () => {
    const s = await tehSession();
    const original = 'Attendance rose by 3.2% in districts that served hot meals.';
    const helper = recordedHelper({ [original]: 'Attendance rose by 3.2%, in districts that served hot meals.' });
    const run = await suggestRewrites(s, helper, 'business', live());
    expect(run).toMatchObject({ added: 0, punctuationOnly: 1, rejected: [] });
    expect(s.candidates().filter((c) => c.source === 'llm')).toEqual([]);
    expect(s.sentToHelper(0, SECOND)).toBe(true);
  });

  it('sends sentences with accepted rule edits applied; a passing rewrite becomes a review-tier llm Rewrite over the whole sentence', async () => {
    const s = await tehSession();
    const helper = recordedHelper({
      'Attendance rose by 3.2% in districts that served hot meals.': 'Attendance rose by 3.2% in districts serving hot meals.',
    });
    const run = await suggestRewrites(s, helper, 'business', live());

    expect(helper.sent).toEqual(['I think the cat of here.', 'Attendance rose by 3.2% in districts that served hot meals.']);
    expect(run).toEqual({ sent: 2, added: 1, punctuationOnly: 0, rejected: [], stale: 0, cancelled: false });
    const llm = s.candidates().filter((c) => c.source === 'llm');
    expect(llm).toHaveLength(1);
    expect(llm[0]).toMatchObject({
      paraId: 0,
      span: SECOND,
      original: 'Attendance rose by 3.2% in districts that served hot meals.',
      replacements: ['Attendance rose by 3.2% in districts serving hot meals.'],
      kind: 'Rewrite',
      source: 'llm',
    });
    expect(s.tier(llm[0].id)).toBe('review');
    expect(s.outcomes().find((o) => o.candidate.id === llm[0].id)?.status).toBe('pending');
    // Never auto-applied; ranked with the other decisions even though its sentence holds a number.
    expect(s.outputText(0)).toBe('I think the cat of here. Attendance rose by 3.2% in districts that served hot meals.');
    const top = s.decisions().top;
    const at = (id: string) => top.findIndex((d) => d.candidateIds.includes(id));
    const style = s.candidates().find((c) => c.kind === 'Style')!;
    expect(at(llm[0].id)).toBeGreaterThanOrEqual(0);
    expect(at(llm[0].id)).toBeLessThan(at(style.id)); // weight 4 beats Style's 1: not folded as "touches a locked span"
  });

  it('accepting a rewrite supersedes the rule edits in its sentence; undo brings them back', async () => {
    const s = await tehSession();
    await suggestRewrites(s, recordedHelper({ 'I think the cat of here.': 'I think that the cat of here.' }), 'business', live());
    const llm = s.candidates().find((c) => c.source === 'llm')!;
    expect(llm.original).toBe('I think teh cat of of here.');
    s.accept(llm.id);
    expect(s.outputText(0)).toBe('I think that the cat of here. Attendance rose by 3.2% in districts that served hot meals.');
    s.undo(llm.id);
    expect(s.outputText(0)).toBe('I think the cat of here. Attendance rose by 3.2% in districts that served hot meals.');
  });

  it('a rewrite the guard rejects is not offered, and is reported with its reason', async () => {
    const s = await tehSession();
    const hedged = 'Attendance broadly rose by 3.2% in districts serving hot meals.';
    const run = await suggestRewrites(
      s,
      recordedHelper({ 'Attendance rose by 3.2% in districts that served hot meals.': hedged, 'I think the cat of here.': 'I think the cat of here at 5.' }),
      'business',
      live(),
    );
    expect(run.added).toBe(0);
    expect(run.rejected).toEqual([
      { text: 'I think the cat of here.', rewrite: 'I think the cat of here at 5.', reason: 'fact changed' },
      { text: 'Attendance rose by 3.2% in districts that served hot meals.', rewrite: hedged, reason: 'hedge added' },
    ]);
    expect(s.candidates().some((c) => c.source === 'llm')).toBe(false);
  });

  it('"check more sentences": a second run sends only sentences not sent before', async () => {
    const s = await start([{ id: 0, text: 'One two three four. Five six seven eight. Nine ten eleven twelve.' }]);
    s.addCandidates([styleLint(0, { start: 0, end: 3 }), styleLint(0, { start: 20, end: 24 }), styleLint(0, { start: 42, end: 46 })]);
    const helper = recordedHelper({});
    // 12 words → rewriteBudget 1 per "more" run.
    await suggestRewrites(s, helper, 'business', live(), { more: true });
    await suggestRewrites(s, helper, 'business', live(), { more: true });
    await suggestRewrites(s, helper, 'business', live(), { more: true });
    expect(helper.sent).toEqual(['One two three four.', 'Five six seven eight.', 'Nine ten eleven twelve.']);
    expect((await suggestRewrites(s, helper, 'business', live(), { more: true })).sent).toBe(0);
  });

  it('the first run never pushes a document over the decision budget; "more" may (spec §10)', async () => {
    // 773 words: room for floor(10 * 773 / 1500) = 5 ranked decisions. Fill it with 5 distinct lints.
    const s = await tehSession();
    const filler = [0, 24, 48, 72, 96].map((at, i) => ({ ...styleLint(1, { start: at, end: at + 3 }), message: `Lint ${i}` }));
    s.addCandidates(filler);
    expect(s.rankedDecisionCount()).toBeGreaterThanOrEqual(5);
    const helper = recordedHelper({});
    expect((await suggestRewrites(s, helper, 'business', live())).sent).toBe(0);
    expect(helper.sent).toEqual([]);
    // An explicit "Check more sentences" gets the normal budget: round(3 * 773 / 1500) = 2.
    expect((await suggestRewrites(s, helper, 'business', live(), { more: true })).sent).toBe(2);
  });

  it('"Check how it reads" on a short document (no room under the depth, or nothing to review) still sends 1 sentence', async () => {
    // 27 words: upFrontRoom = floor(10 * 27 / 1500) = 0.
    const short = await start([{ id: 0, text: 'The council met on a wet morning to talk about roads, schools, water supply, the new market, the bus depot and the park.' }]);
    expect(runBudget(short, false)).toBe(1);
    // 773 words with nothing to review: room 5, 0 ranked → the depth's rate, 2.
    const clean = await start([{ id: 0, text: FILLER }]);
    expect(clean.rankedDecisionCount()).toBe(0);
    expect(runBudget(clean, false)).toBe(Math.max(1, Math.round((3 * 756) / 1500)));
  });

  it('a review that is really full gets no floor: "Check how it reads" sends nothing', async () => {
    const s = await tehSession();
    s.addCandidates([0, 24, 48, 72, 96].map((at, i) => ({ ...styleLint(1, { start: at, end: at + 3 }), message: `Lint ${i}` })));
    expect(runBudget(s, false)).toBe(0);
  });

  it('the first run is capped by the room left under the budget', async () => {
    const s = await tehSession();
    const room = Math.floor((10 * 773) / 1500) - s.rankedDecisionCount();
    expect(room).toBeGreaterThanOrEqual(2); // so the other first-run tests here send 2 sentences
  });

  it('cancelling keeps the results that already came back', async () => {
    const s = await tehSession();
    const ac = new AbortController();
    const helper: Rewriter = {
      async rewrite(text, _preset, _variant, signal) {
        if (text.startsWith('I think')) {
          ac.abort(); // the user presses Cancel while the first answer arrives
          return 'I think that the cat of here.';
        }
        signal.throwIfAborted();
        return null;
      },
    };
    const run = await suggestRewrites(s, helper, 'business', ac.signal);
    expect(run).toMatchObject({ sent: 1, added: 1, cancelled: true });
    expect(s.candidates().filter((c) => c.source === 'llm').map((c) => c.span)).toEqual([FIRST]);
  });

  it('a helper failure that is not a cancel is thrown, keeping earlier results', async () => {
    const s = await tehSession();
    const helper: Rewriter = {
      async rewrite(text) {
        if (text.startsWith('I think')) return 'I think that the cat of here.';
        throw new Error('The writing helper stopped responding.');
      },
    };
    await expect(suggestRewrites(s, helper, 'business', live())).rejects.toThrow('stopped responding');
    expect(s.candidates().filter((c) => c.source === 'llm')).toHaveLength(1);
  });
});

describe('CheckSession.addRewrite', () => {
  it('runs the guard itself: an unguarded fact-changing rewrite is refused, but the sentence counts as sent', async () => {
    const s = await tehSession();
    const verdict = s.addRewrite(0, SECOND, 'Attendance rose by 3% in districts serving hot meals.');
    expect(verdict).toEqual({ ok: false, reason: 'fact changed' });
    expect(s.candidates().some((c) => c.source === 'llm')).toBe(false);
    expect(s.sentToHelper(0, SECOND)).toBe(true);
  });

  it('guards against the text sent (accepted rule edits applied) and returns ok for a passing rewrite', async () => {
    const s = await tehSession();
    expect(s.addRewrite(0, FIRST, 'I think that the cat of here.')).toEqual({ ok: true });
    expect(s.addRewrite(0, SECOND, null)).toBeNull();
    expect(s.candidates().filter((c) => c.source === 'llm').map((c) => c.original)).toEqual(['I think teh cat of of here.']);
  });

  it('an llm candidate added without the guard (addCandidates) still folds when it touches locked text', async () => {
    const s = await tehSession();
    s.addCandidates([
      {
        id: 'llm:raw',
        paraId: 0,
        span: SECOND,
        original: TEH.slice(SECOND.start, SECOND.end),
        replacements: ['Attendance rose by 3% in districts serving hot meals.'],
        kind: 'Rewrite',
        message: 'Rewrite',
        source: 'llm',
      },
    ]);
    const top = s.decisions().top;
    const at = (id: string) => top.findIndex((d) => d.candidateIds.includes(id));
    const style = s.candidates().find((c) => c.kind === 'Style')!;
    expect(at('llm:raw')).toBeGreaterThan(at(style.id));
  });

  it('rejects a span outside its paragraph', async () => {
    const s = await start([{ id: 0, text: 'Short.' }]);
    expect(() => s.addRewrite(0, { start: 0, end: 50 }, 'x')).toThrow(/span/);
    expect(() => s.addRewrite(9, { start: 0, end: 1 }, 'x')).toThrow(/paragraph/);
  });
});
