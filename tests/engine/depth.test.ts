import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEPTHS, DEFAULT_DEPTH, type ReviewDepth } from '@/engine/depth';
import { firstRunBudget, rewriteBudget } from '@/engine/llm/select';
import type { Candidate, Paragraph } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

const DEPTH_NAMES: ReviewDepth[] = ['light', 'standard', 'thorough', 'everything'];

const start = (paras: Paragraph[], over: Partial<CheckOptions> = {}) =>
  CheckSession.start(
    paras,
    { preset: 'business', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [], ...over },
    { linter },
  );

const PLAIN_WORDS = ['the', 'cat', 'sat', 'on', 'a', 'warm', 'mat', 'today'];

/** `words` plain words in one paragraph (no real lints), with a distinct lint on every 20th word: many ranked decisions. */
async function lintedDoc(words: number, over: Partial<CheckOptions> = {}) {
  const tokens = Array.from({ length: words }, (_, i) => PLAIN_WORDS[i % PLAIN_WORDS.length]);
  const text = tokens.join(' ');
  const s = await start([{ id: 0, text }], over);
  const lints: Candidate[] = [];
  let at = 0;
  tokens.forEach((t, i) => {
    if (i % 20 === 0) {
      lints.push({
        id: `depth:${i}`,
        paraId: 0,
        span: { start: at, end: at + t.length },
        original: t,
        replacements: [],
        kind: 'Grammar',
        message: `Lint ${i}`,
        source: 'rules',
      });
    }
    at += t.length + 1;
  });
  s.addCandidates(lints);
  return s;
}

describe('DEPTHS', () => {
  it('holds the owner table: up-front decisions and automatic rewrites per 1,500 words', () => {
    expect(DEFAULT_DEPTH).toBe('standard');
    expect(DEPTHS.light).toMatchObject({ decisionsPer1500: 5, rewritesPer1500: 1 });
    expect(DEPTHS.standard).toMatchObject({ decisionsPer1500: 10, rewritesPer1500: 3 });
    expect(DEPTHS.thorough).toMatchObject({ decisionsPer1500: 25, rewritesPer1500: 6 });
    expect(DEPTHS.everything).toMatchObject({ decisionsPer1500: 'all', rewritesPer1500: 0 });
  });
});

describe('decisions() size by depth', () => {
  const cases: [ReviewDepth, number, number][] = [
    ['light', 5, 10],
    ['standard', 10, 20],
    ['thorough', 25, 50],
  ];
  for (const [depth, at1500, at3000] of cases) {
    it(`${depth}: top is ${at1500} at 1,500 words and ${at3000} at 3,000`, async () => {
      const a = await lintedDoc(1500, { depth });
      expect(a.decisions().top).toHaveLength(at1500);
      expect(a.decisionCount()).toBe(at1500);
      const b = await lintedDoc(3000, { depth });
      expect(b.decisions().top).toHaveLength(at3000);
    });
  }

  it('everything: top holds every ranked decision and more is empty', async () => {
    const s = await lintedDoc(1500, { depth: 'everything' });
    const { top, more } = s.decisions();
    expect(more).toEqual([]);
    expect(top.length).toBe(s.rankedDecisionCount());
    expect(top.length).toBeGreaterThan(25);
  });

  it('defaults to standard', async () => {
    const s = await lintedDoc(1500);
    expect(s.decisions().top).toHaveLength(10);
  });

  it('a 9-word document shows min(floor, ranked) up front: floors 3 / 10 / 25, everything all', async () => {
    const floors: [ReviewDepth, number][] = [['light', 3], ['standard', 10], ['thorough', 25], ['everything', 99]];
    for (const [depth, floor] of floors) {
      const s = await lintedDoc(9, { depth });
      // lintedDoc puts one lint on word 0 only, so add more to exceed every floor.
      const extra: Candidate[] = Array.from({ length: 30 }, (_, i) => ({
        id: `short:${i}`, paraId: 0, span: { start: 0, end: 1 }, original: 't', replacements: [],
        kind: 'Grammar', message: `Short ${i}`, source: 'rules' as const,
      }));
      s.addCandidates(extra);
      const ranked = s.rankedDecisionCount();
      expect(s.decisions().top).toHaveLength(depth === 'everything' ? ranked : floor);
    }
  });

  it('a short document with few decisions shows them all (floor is a cap on nothing)', async () => {
    const s = await start([{ id: 0, text: 'We met Anjali Kulkarni in Nashik today.' }], { depth: 'light' });
    expect(s.decisions().top).toHaveLength(1);
  });

  it('rankedDecisionCount does not depend on depth', async () => {
    const counts = await Promise.all(DEPTH_NAMES.map(async (depth) => (await lintedDoc(1500, { depth })).rankedDecisionCount()));
    expect(new Set(counts).size).toBe(1);
  });
});

describe('setDepth', () => {
  it('changes decisions() live without changing any status', async () => {
    const s = await lintedDoc(1500);
    const statuses = () => s.outcomes().map((o) => [o.candidate.id, o.status, o.auto]);
    const before = statuses();
    expect(s.decisions().top).toHaveLength(10);
    s.setDepth('thorough');
    expect(s.decisions().top).toHaveLength(25);
    s.setDepth('light');
    expect(s.decisions().top).toHaveLength(5);
    s.setDepth('everything');
    expect(s.decisions().more).toEqual([]);
    expect(statuses()).toEqual(before);
  });
});

describe('depth never changes what is applied', () => {
  it('tiers, auto-applied edits and acceptedEdits are the same at all four depths', async () => {
    const text =
      'I think teh cat is is here. We recieve the money tommorow and it dont matter. ' +
      'Anjali Kulkarni visited Nashik in 2019, and the the report was late. ' +
      'The committee has decided that the proposal which was submitted by the team will be reviewed.';
    const snapshots = [];
    for (const depth of DEPTH_NAMES) {
      const s = await start([{ id: 0, text }], { depth });
      snapshots.push({
        tiers: s.candidates().map((c) => [c.id, s.tier(c.id)]),
        auto: s.outcomes().filter((o) => o.auto).map((o) => [o.candidate.id, o.status, o.replacement]),
        accepted: s.acceptedEdits(),
        output: s.outputText(0),
      });
    }
    expect(snapshots[0].tiers.length).toBeGreaterThan(3);
    expect(snapshots[0].auto.length).toBeGreaterThan(0);
    for (const snap of snapshots) expect(snap).toEqual(snapshots[0]);
  });
});

describe('LLM first-run budget by depth', () => {
  it('uses the depth rewrite rate: 1 / 3 / 6 per 1,500 words, 0 for everything', () => {
    expect(rewriteBudget(1500, 'light')).toBe(1);
    expect(rewriteBudget(1500, 'standard')).toBe(3);
    expect(rewriteBudget(1500, 'thorough')).toBe(6);
    expect(rewriteBudget(1500, 'everything')).toBe(0);
    expect(rewriteBudget(3000, 'thorough')).toBe(12);
  });

  it('light and everything first runs', () => {
    expect(firstRunBudget(1500, 0, 'light')).toBe(1);
    expect(firstRunBudget(1500, 0, 'standard')).toBe(3);
    expect(firstRunBudget(1500, 0, 'thorough')).toBe(6);
    expect(firstRunBudget(1500, 0, 'everything')).toBe(0);
  });

  it('the room rule uses the depth up-front budget', () => {
    expect(firstRunBudget(1500, 4, 'light')).toBe(1); // room 5 - 4
    expect(firstRunBudget(1500, 5, 'light')).toBe(0);
    expect(firstRunBudget(1500, 22, 'thorough')).toBe(3); // room 25 - 22
    expect(firstRunBudget(1500, 25, 'thorough')).toBe(0);
  });
});
