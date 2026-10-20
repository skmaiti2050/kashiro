import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { suggestRewrites, type Rewriter } from '@/engine/llm/suggest';
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
function recordedHelper(answers: Record<string, string>): Rewriter & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async rewrite(text) {
      sent.push(text);
      return answers[text] ?? null;
    },
  };
}

const live = () => new AbortController().signal;

const TEH = 'I think teh cat is is here. Attendance rose by 3.2% in districts that served hot meals.';
const FIRST = { start: 0, end: 27 };
const SECOND = { start: 28, end: TEH.length };

/** 756 words of clean filler (score 0, never picked): with TEH the budget is round(3 * 773 / 1500) = 2. */
const FILLER = 'The cat sat on the mat. '.repeat(126).trim();

async function tehSession() {
  const s = await start([{ id: 0, text: TEH }, { id: 1, text: FILLER }]);
  s.addCandidates([styleLint(0, { start: 0, end: 1 }), styleLint(0, { start: 28, end: 38 })]);
  return s;
}

describe('suggestRewrites', () => {
  it('sends sentences with accepted rule edits applied; a passing rewrite becomes a review-tier llm Rewrite over the whole sentence', async () => {
    const s = await tehSession();
    const helper = recordedHelper({
      'Attendance rose by 3.2% in districts that served hot meals.': 'Attendance rose by 3.2% in districts serving hot meals.',
    });
    const run = await suggestRewrites(s, helper, 'business', live());

    expect(helper.sent).toEqual(['I think the cat is here.', 'Attendance rose by 3.2% in districts that served hot meals.']);
    expect(run).toEqual({ sent: 2, added: 1, rejected: [], cancelled: false });
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
    expect(s.outputText(0)).toBe('I think the cat is here. Attendance rose by 3.2% in districts that served hot meals.');
    const top = s.decisions().top;
    const at = (id: string) => top.findIndex((d) => d.candidateIds.includes(id));
    const style = s.candidates().find((c) => c.kind === 'Style')!;
    expect(at(llm[0].id)).toBeGreaterThanOrEqual(0);
    expect(at(llm[0].id)).toBeLessThan(at(style.id)); // weight 4 beats Style's 1: not folded as "touches a locked span"
  });

  it('accepting a rewrite supersedes the rule edits in its sentence; undo brings them back', async () => {
    const s = await tehSession();
    await suggestRewrites(s, recordedHelper({ 'I think the cat is here.': 'I think that the cat is here.' }), 'business', live());
    const llm = s.candidates().find((c) => c.source === 'llm')!;
    expect(llm.original).toBe('I think teh cat is is here.');
    s.accept(llm.id);
    expect(s.outputText(0)).toBe('I think that the cat is here. Attendance rose by 3.2% in districts that served hot meals.');
    s.undo(llm.id);
    expect(s.outputText(0)).toBe('I think the cat is here. Attendance rose by 3.2% in districts that served hot meals.');
  });

  it('a rewrite the guard rejects is not offered, and is reported with its reason', async () => {
    const s = await tehSession();
    const hedged = 'Attendance broadly rose by 3.2% in districts serving hot meals.';
    const run = await suggestRewrites(
      s,
      recordedHelper({ 'Attendance rose by 3.2% in districts that served hot meals.': hedged, 'I think the cat is here.': 'I think the cat is here at 5.' }),
      'business',
      live(),
    );
    expect(run.added).toBe(0);
    expect(run.rejected).toEqual([
      { text: 'I think the cat is here.', rewrite: 'I think the cat is here at 5.', reason: 'fact changed' },
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

  it('the first run is capped by the room left under the budget', async () => {
    const s = await tehSession();
    const room = Math.floor((10 * 773) / 1500) - s.rankedDecisionCount();
    expect(room).toBeGreaterThanOrEqual(2); // so the other first-run tests here send 2 sentences
  });

  it('cancelling keeps the results that already came back', async () => {
    const s = await tehSession();
    const ac = new AbortController();
    const helper: Rewriter = {
      async rewrite(text, _preset, signal) {
        if (text.startsWith('I think')) {
          ac.abort(); // the user presses Cancel while the first answer arrives
          return 'I think that the cat is here.';
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
        if (text.startsWith('I think')) return 'I think that the cat is here.';
        throw new Error('The writing helper stopped responding.');
      },
    };
    await expect(suggestRewrites(s, helper, 'business', live())).rejects.toThrow('stopped responding');
    expect(s.candidates().filter((c) => c.source === 'llm')).toHaveLength(1);
  });
});

describe('CheckSession.addRewrite', () => {
  it('rejects a span outside its paragraph', async () => {
    const s = await start([{ id: 0, text: 'Short.' }]);
    expect(() => s.addRewrite(0, { start: 0, end: 50 }, 'x')).toThrow(/span/);
    expect(() => s.addRewrite(9, { start: 0, end: 1 }, 'x')).toThrow(/paragraph/);
  });
});
