import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { firstRunBudget, pickSentences, rewriteBudget, sentenceAt } from '@/engine/llm/select';
import type { Candidate, Paragraph, Span } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

const start = (paras: Paragraph[], preset: 'business' | 'script' = 'business') =>
  CheckSession.start(paras, { preset, variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [] }, { linter });

let seq = 0;
/** A rules lint injected on `span`, so the ranking does not depend on what Harper flags. */
const lint = (paraId: number, span: Span, kind: string): Candidate => ({
  id: `test:${seq++}`,
  paraId,
  span,
  original: 'x',
  replacements: [],
  kind,
  message: kind,
  source: 'rules',
});

const PARA0 = 'The cat sat on the mat. The dog lay by the door. Birds sang in the old tree.';
const DOG = { start: 24, end: 48 };
const BIRDS = { start: 49, end: 76 };
const LONG =
  'The council met on a wet morning to talk about roads, schools, water supply, the new market, ' +
  'the bus depot, the old library and the park, and it agreed to meet again in the spring.';

async function rankedSession(preset: 'business' | 'script' = 'business') {
  const s = await start([{ id: 0, text: PARA0 }, { id: 1, text: LONG }], preset);
  s.addCandidates([
    lint(0, { start: 28, end: 31 }, 'Style'), // "dog": +3
    lint(0, { start: 49, end: 54 }, 'Grammar'), // two lints on "Birds…": +1
    lint(0, { start: 55, end: 59 }, 'Grammar'),
  ]);
  return s;
}

describe('rewriteBudget', () => {
  it('is max(1, round(3 * words / 1500))', () => {
    expect(rewriteBudget(1500)).toBe(3);
    expect(rewriteBudget(1000)).toBe(2);
    expect(rewriteBudget(2250)).toBe(5);
    expect(rewriteBudget(3000)).toBe(6);
    expect(rewriteBudget(100)).toBe(1);
    expect(rewriteBudget(0)).toBe(1);
  });
});

describe('firstRunBudget', () => {
  it('is max(0, min(rewriteBudget(words), floor(10 * words / 1500) - ranked))', () => {
    expect(firstRunBudget(1500, 0)).toBe(3);
    expect(firstRunBudget(1500, 8)).toBe(2);
    expect(firstRunBudget(1500, 10)).toBe(0);
    expect(firstRunBudget(1500, 13)).toBe(0);
    expect(firstRunBudget(1022, 4)).toBe(2); // floor(6.81) - 4 = 2 = rewriteBudget
    expect(firstRunBudget(1178, 6)).toBe(1); // floor(7.85) - 6
    expect(firstRunBudget(12, 0)).toBe(0); // floor(0.08) = 0: no room in a tiny text
  });
});

describe('pickSentences', () => {
  it('ranks Readability/Style/WordOrder lint (+3), then > 30 words (+2), then ≥2 rules lints (+1); skips score 0', async () => {
    const s = await rankedSession();
    expect(LONG.split(' ').length).toBeGreaterThan(30);
    const picked = pickSentences(s, 10);
    expect(picked.map((p) => [p.paraId, p.span])).toEqual([
      [0, DOG],
      [1, { start: 0, end: LONG.length }],
      [0, BIRDS],
    ]);
    expect(picked[0].text).toBe('The dog lay by the door.');
  });

  it('returns at most `budget` sentences, best first', async () => {
    const s = await rankedSession();
    expect(pickSentences(s, 2).map((p) => p.span)).toEqual([DOG, { start: 0, end: LONG.length }]);
  });

  it('lints the preset hides do not count', async () => {
    const s = await rankedSession('script'); // script hides Style
    expect(pickSentences(s, 10).map((p) => p.paraId)).toEqual([1, 0]);
  });

  it('unknown names (capitalised Spelling flags) do not count as lints', async () => {
    const s = await start([{ id: 0, text: 'Written by Ishaan Bhatt.' }]);
    const name = (span: Span, original: string): Candidate => ({ ...lint(0, span, 'Spelling'), original, replacements: ['Ishmael'] });
    s.addCandidates([name({ start: 11, end: 17 }, 'Ishaan'), name({ start: 18, end: 23 }, 'Bhatt')]);
    expect(pickSentences(s, 10)).toEqual([]);
  });

  it('excludes sentences already sent to the helper', async () => {
    const s = await rankedSession();
    s.addRewrite(0, DOG, null);
    s.addRewrite(1, { start: 0, end: LONG.length }, 'The council met on a wet morning.');
    expect(pickSentences(s, 10).map((p) => p.span)).toEqual([BIRDS]);
  });

  it('the text sent has the accepted rule edits applied; the span is the original sentence', async () => {
    const text = 'I think teh cat of of here. It sleeps.';
    const s = await start([{ id: 0, text }]);
    s.applyBatch(SIMPLE_FIXES_ID);
    s.addCandidates([lint(0, { start: 0, end: 1 }, 'Readability')]);
    expect(s.outputText(0)).toBe('I think the cat of here. It sleeps.');
    expect(pickSentences(s, 3)).toEqual([{ paraId: 0, span: { start: 0, end: 27 }, text: 'I think the cat of here.' }]);
  });

  it('skips sentences with inline markup or inside a tracked change', async () => {
    const s = await start([
      { id: 0, text: 'This is **bold** text here.' },
      { id: 1, text: 'This one sits in a change.', locked: [{ start: 5, end: 8 }] },
    ]);
    s.addCandidates([lint(0, { start: 0, end: 4 }, 'Style'), lint(1, { start: 0, end: 4 }, 'Style')]);
    expect(pickSentences(s, 10)).toEqual([]);
  });
});

describe('sentenceAt ("Improve this sentence")', () => {
  it('the sentence at an offset, with its accepted edits applied, whether or not it has a lint', async () => {
    const text = 'I think teh cat of of here. It sleeps.';
    const s = await start([{ id: 0, text }]);
    s.applyBatch(SIMPLE_FIXES_ID);
    expect(sentenceAt(s, 0, 3)).toEqual({ paraId: 0, span: { start: 0, end: 27 }, text: 'I think the cat of here.' });
    expect(sentenceAt(s, 0, 30)).toEqual({ paraId: 0, span: { start: 28, end: 38 }, text: 'It sleeps.' });
  });

  it('a caret at the end of a sentence or in the space after it means that sentence', async () => {
    const s = await start([{ id: 0, text: PARA0 }]);
    expect(sentenceAt(s, 0, DOG.end)?.span).toEqual(DOG);
    expect(sentenceAt(s, 0, 23)?.span).toEqual({ start: 0, end: 23 });
    expect(sentenceAt(s, 0, 0)?.span).toEqual({ start: 0, end: 23 });
  });

  it('a sentence already sent is still found (the caller decides); one a rewrite could damage is not', async () => {
    const s = await start([
      { id: 0, text: 'This is **bold** text here.' },
      { id: 1, text: 'This one sits in a change.', locked: [{ start: 5, end: 8 }] },
      { id: 2, text: PARA0 },
    ]);
    expect(sentenceAt(s, 0, 2)).toBeNull();
    expect(sentenceAt(s, 1, 2)).toBeNull();
    s.addRewrite(2, DOG, null);
    expect(sentenceAt(s, 2, DOG.start)?.span).toEqual(DOG);
    expect(sentenceAt(s, 9, 0)).toBeNull(); // no such paragraph
  });
});
