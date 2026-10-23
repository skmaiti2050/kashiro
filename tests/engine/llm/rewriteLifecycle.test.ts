/**
 * An AI rewrite after it is asked for (Task 13 UI): a sentence that changes while the helper works never gets
 * the stale rewrite; a pending rewrite whose sentence changes is withdrawn; "Accept all helper suggestions" is
 * one undo step; a re-check carries the rewrites of unchanged paragraphs.
 */
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

const TEXT = 'Attendance rose by 3.2% in districts that served hot meals. The cat sat on the mat for a very long time.';
const FIRST: Span = { start: 0, end: 59 };
const SECOND: Span = { start: 60, end: TEXT.length };
const FIRST_TEXT = TEXT.slice(FIRST.start, FIRST.end);
const SECOND_TEXT = TEXT.slice(SECOND.start, SECOND.end);
const FIRST_REWRITE = 'Attendance rose by 3.2% in districts serving hot meals.';
const SECOND_REWRITE = 'The cat sat on the mat for a long time.';

/** A review-tier word fix inside the first sentence ("Attendance" → "Turnout"), plus a lint that gets it picked. */
const turnout: Candidate = {
  id: 'test:turnout',
  paraId: 0,
  span: { start: 0, end: 10 },
  original: 'Attendance',
  replacements: ['Turnout'],
  kind: 'WordChoice',
  message: 'Shorter word',
  source: 'rules',
};
const styleOn = (span: Span, id: string): Candidate => ({ id, paraId: 0, span, original: 'x', replacements: [], kind: 'Style', message: 'Style', source: 'rules' });

async function session() {
  const s = await start([{ id: 0, text: TEXT }]);
  s.addCandidates([turnout, styleOn({ start: 11, end: 15 }, 'test:s1'), styleOn({ start: 64, end: 67 }, 'test:s2')]);
  expect(s.tier(turnout.id)).toBe('review');
  return s;
}

const llmIds = (s: CheckSession) => s.candidates().filter((c) => c.source === 'llm').map((c) => c.id);
const statusOf = (s: CheckSession, id: string) => s.outcomes().find((o) => o.candidate.id === id)!.status;

describe('a sentence that changes while the helper works', () => {
  it('drops the stale rewrite, counts it, and leaves the sentence free to ask again', async () => {
    const s = await session();
    const helper: Rewriter = {
      async rewrite(text) {
        // The user accepts a rule fix in this sentence while its rewrite is on the way.
        if (text === FIRST_TEXT) s.accept(turnout.id);
        return text === FIRST_TEXT ? FIRST_REWRITE : null;
      },
    };
    const run = await suggestRewrites(s, helper, 'business', new AbortController().signal, { more: true });
    expect(run).toMatchObject({ added: 0, stale: 1 });
    expect(llmIds(s)).toEqual([]);
    expect(s.sentToHelper(0, FIRST)).toBe(false);
    expect(s.outputText(0)).toBe(TEXT.replace('Attendance', 'Turnout'));

    const sent: string[] = [];
    await suggestRewrites(s, { rewrite: async (text) => (sent.push(text), null) }, 'business', new AbortController().signal, { more: true });
    expect(sent).toContain('Turnout rose by 3.2% in districts that served hot meals.');
  });

  it('addRewrite refuses a rewrite of text the sentence no longer reads', async () => {
    const s = await session();
    s.accept(turnout.id);
    expect(s.addRewrite(0, FIRST, FIRST_REWRITE, FIRST_TEXT)).toBe('stale');
    expect(s.addRewrite(0, FIRST, null, FIRST_TEXT)).toBe('stale');
    expect(s.sentToHelper(0, FIRST)).toBe(false);
    expect(s.addRewrite(0, FIRST, 'Turnout rose by 3.2% in districts serving hot meals.', 'Turnout rose by 3.2% in districts that served hot meals.')).toEqual({ ok: true });
  });
});

describe('a pending rewrite whose sentence then changes', () => {
  it('is withdrawn (never applied over the new text), and the sentence can be asked again', async () => {
    const s = await session();
    expect(s.addRewrite(0, FIRST, FIRST_REWRITE, FIRST_TEXT)).toEqual({ ok: true });
    const [id] = llmIds(s);
    s.accept(turnout.id);
    expect(statusOf(s, id)).toBe('superseded');
    expect(s.outcomes().find((o) => o.candidate.id === id)!.reason).toBe('the sentence changed after the AI suggestion was made');
    expect(s.decisions().top.some((d) => d.candidateIds.includes(id))).toBe(false);
    expect(s.sentToHelper(0, FIRST)).toBe(false);
    expect(() => s.accept(id)).toThrow();
    // Undoing the rule fix does not bring the withdrawn rewrite back.
    s.undo(turnout.id);
    expect(statusOf(s, id)).toBe('superseded');
    expect(s.outputText(0)).toBe(TEXT);
  });

  it('asked again after the withdrawal: a pending suggestion with the new text, which can be accepted', async () => {
    const s = await session();
    s.addRewrite(0, FIRST, FIRST_REWRITE, FIRST_TEXT);
    s.accept(turnout.id); // withdraws it
    const now = 'Turnout rose by 3.2% in districts that served hot meals.';
    const again = 'Turnout rose by 3.2% in districts serving hot meals.';
    expect(s.addRewrite(0, FIRST, again, now)).toEqual({ ok: true });
    const pending = s.outcomes().filter((o) => o.candidate.source === 'llm' && o.status === 'pending');
    expect(pending.map((o) => o.candidate.replacements[0])).toEqual([again]);
    s.accept(pending[0].candidate.id);
    expect(s.outputText(0)).toBe(`${again} ${SECOND_TEXT}`);
  });

  it('a re-asked suggestion whose id was applied before shows its new text in the outcome and the log', async () => {
    const s = await session();
    s.accept(turnout.id);
    const withFix = 'Turnout rose by 3.2% in districts that served hot meals.';
    const oldRewrite = 'Turnout rose by 3.2% in districts serving hot meals.';
    s.addRewrite(0, FIRST, oldRewrite, withFix);
    const id = llmIds(s)[0];
    s.accept(id); // apply
    s.undo(id); // applied → rejected
    s.undo(turnout.id); // the rule fix undone: the sentence reads FIRST_TEXT again
    s.undo(id); // rejected → pending, and withdrawn at once (its sentence changed)
    expect(statusOf(s, id)).toBe('superseded');
    expect(s.addRewrite(0, FIRST, FIRST_REWRITE, FIRST_TEXT)).toEqual({ ok: true });
    expect(s.outcomes().find((o) => o.candidate.id === id)!.replacement).toBe(FIRST_REWRITE);
    s.reject(id);
    // The change log row (Outcome) shows the new text; the log entry carries no old one (a rejection records none).
    expect(s.outcomes().find((o) => o.candidate.id === id)!.replacement).toBe(FIRST_REWRITE);
    const entry = s.log().filter((e) => e.candidateId === id).at(-1)!;
    expect(entry.status).toBe('rejected');
    expect(entry.replacement).not.toBe(oldRewrite);
    s.undo(id);
    s.accept(id);
    expect(s.log().filter((e) => e.candidateId === id).at(-1)).toMatchObject({ status: 'applied', replacement: FIRST_REWRITE });
  });

  it('rejecting another flag in the sentence changes nothing', async () => {
    const s = await session();
    s.addRewrite(0, FIRST, FIRST_REWRITE, FIRST_TEXT);
    s.reject('test:s1');
    expect(statusOf(s, llmIds(s)[0])).toBe('pending');
  });
});

describe('applyRewrites ("Accept all helper suggestions")', () => {
  it('applies the chosen rewrites as one batch that undoBatch takes back in one step', async () => {
    const s = await session();
    s.addRewrite(0, FIRST, FIRST_REWRITE, FIRST_TEXT);
    s.addRewrite(0, SECOND, SECOND_REWRITE, SECOND_TEXT);
    const ids = llmIds(s);
    const batch = s.applyRewrites(ids);
    expect(s.outputText(0)).toBe(`${FIRST_REWRITE} ${SECOND_REWRITE}`);
    expect(s.outcomes().filter((o) => o.batch === batch).map((o) => o.candidate.id)).toEqual(ids);
    s.undoBatch(batch);
    expect(s.outputText(0)).toBe(TEXT);
  });

  it('only takes pending AI rewrites', async () => {
    const s = await session();
    s.addRewrite(0, FIRST, FIRST_REWRITE, FIRST_TEXT);
    expect(() => s.applyRewrites([turnout.id])).toThrow('test:turnout is not a pending AI suggestion');
    expect(() => s.applyRewrites([])).toThrow();
    const [id] = llmIds(s);
    s.reject(id);
    expect(() => s.applyRewrites([id])).toThrow('is not a pending AI suggestion');
    expect(s.outputText(0)).toBe(TEXT);
  });
});

describe('carryRewritesFrom (a re-check keeps the AI results of unchanged paragraphs)', () => {
  const OTHER = 'A short second paragraph sits here.';

  async function before() {
    const s = await start([{ id: 0, text: TEXT }, { id: 1, text: OTHER }]);
    s.addRewrite(0, FIRST, FIRST_REWRITE, FIRST_TEXT);
    s.addRewrite(0, SECOND, SECOND_REWRITE, SECOND_TEXT);
    s.addRewrite(1, { start: 0, end: OTHER.length }, 'A short second paragraph is here.', OTHER);
    const [first, second] = llmIds(s);
    s.accept(first);
    s.reject(second);
    return s;
  }

  it('re-adds them through the guard and replays accepted and rejected; changed paragraphs lose theirs', async () => {
    const old = await before();
    // Paragraph 1 was edited; paragraph 0 moved to id 5.
    const after = await start([{ id: 5, text: TEXT }, { id: 6, text: 'A short second paragraph sits there.' }]);
    const carried = after.carryRewritesFrom(old, new Map([[0, 5]]));
    expect([...carried.values()]).toEqual(['llm:5:0-59', 'llm:5:60-' + TEXT.length]);
    expect(after.outputText(5)).toBe(`${FIRST_REWRITE} ${SECOND_TEXT}`);
    expect(statusOf(after, 'llm:5:60-' + TEXT.length)).toBe('rejected');
    expect(after.candidates().filter((c) => c.paraId === 6 && c.source === 'llm')).toEqual([]);
    expect(after.sentToHelper(5, FIRST)).toBe(true);
    expect(after.sentToHelper(6, { start: 0, end: OTHER.length })).toBe(false);
  });

  it('sentences answered with nothing stay sent, so "Check more sentences" does not ask again', async () => {
    const old = await start([{ id: 0, text: TEXT }]);
    old.addRewrite(0, SECOND, null, SECOND_TEXT);
    const after = await start([{ id: 0, text: TEXT }]);
    after.carryRewritesFrom(old, new Map([[0, 0]]));
    expect(after.sentToHelper(0, SECOND)).toBe(true);
  });

  it('drops a rewrite whose sentence now reads differently (a rule fix no longer offered)', async () => {
    const old = await session();
    old.accept(turnout.id);
    old.addRewrite(0, FIRST, 'Turnout rose by 3.2% in districts serving hot meals.', 'Turnout rose by 3.2% in districts that served hot meals.');
    const after = await start([{ id: 0, text: TEXT }]); // no "Turnout" fix this time
    after.carryRewritesFrom(old, new Map([[0, 0]]));
    expect(llmIds(after)).toEqual([]);
    expect(after.sentToHelper(0, FIRST)).toBe(false);
  });
});
