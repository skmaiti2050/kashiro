/**
 * #1 gate 1: a paragraph another engine checks gets the same never-damage locks as an English one, and nothing
 * there is applied without a click until that language has its own tier policy (gate 9).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { CheckOptions } from '@/engine/sessionTypes';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
import { SPLITS_CHARACTER_REASON } from '@/engine/graphemes';
import type { Candidate, Paragraph, Span } from '@/engine/types';
import { devanagariEngines, fakeEngine } from '../fixtures/fakeEngines';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts: CheckOptions = { preset: 'business', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] };

const ENGLISH = 'We met on teh Monday.';
const HINDI = 'यह एक परीक्षण है।';

/** MOSTLY_HINDI from languageEngine.test.ts, with `first` as paragraph 0 (the one the fake candidate is on). */
const mostlyHindi = (first: Paragraph): Paragraph[] => [first, ...[ENGLISH, HINDI, HINDI].map((text, i) => ({ id: i + 1, text }))];

const withDevanagari = (found: Candidate[]) => ({ linter, scriptEngines: devanagariEngines(fakeEngine({ found })) });

function candidate(text: string, span: Span, replacement: string, kind: string, source: Candidate['source']): Candidate {
  return { id: `0:${span.start}:${span.end}:${kind}`, paraId: 0, span, original: text.slice(span.start, span.end), replacements: [replacement], kind, message: 'fake', source };
}

const outcomeOf = (s: CheckSession, id: string) => s.outcomes().find((o) => o.candidate.id === id)!;

describe('never damage in paragraphs another engine checks', () => {
  it('a whitespace fix in a Hindi paragraph is never applied without a click', async () => {
    // The gap comes after four words: after one to three, a line without a full stop reads as a key and a value
    // ("Total  500", findAlignedParagraphs), and that alone would keep the fix from being zero-click today.
    const text = 'यह एक छोटा सा  परीक्षण है।';
    const gap = text.indexOf('  ');
    const c = candidate(text, { start: gap, end: gap + 2 }, ' ', 'Formatting', 'rules');
    expect(c.original).toBe('  ');
    const s = await CheckSession.start(mostlyHindi({ id: 0, text }), opts, withDevanagari([c]));
    expect(s.engineOf(0)?.id).toBe('fake-hi');
    expect(s.tier(c.id)).toBe('review');
    expect(outcomeOf(s, c.id)).toMatchObject({ status: 'pending', auto: false });
  });

  it('an invisible-character fix in a Hindi paragraph is never applied without a click', async () => {
    const text = 'यह​एक परीक्षण है।';
    const c = candidate(text, { start: 2, end: 3 }, '', 'Invisible', 'hygiene');
    expect(c.original).toBe('​');
    const s = await CheckSession.start(mostlyHindi({ id: 0, text }), opts, withDevanagari([c]));
    expect(s.engineOf(0)?.id).toBe('fake-hi');
    expect(s.tier(c.id)).toBe('review');
    expect(outcomeOf(s, c.id)).toMatchObject({ status: 'pending', auto: false });
  });

  it('a fix over a URL in a Hindi paragraph touches locked text', async () => {
    // Enough Hindi around the URL that the paragraph and the document stay mostly Devanagari (the fake engine's).
    const text = 'कृपया अपना फ़ॉर्म भरने के लिए इस पते पर जाएँ https://example.com और फिर उसे जमा करें।';
    // A punctuation fix, not a spelling one: a word fix would reach the romanised-word check in tierOf, which needs a
    // model only English loads (see the task report).
    const dot = text.indexOf('.com');
    const c = candidate(text, { start: dot, end: dot + 1 }, '. ', 'Punctuation', 'rules');
    expect(c.original).toBe('.');
    const s = await CheckSession.start(mostlyHindi({ id: 0, text }), opts, withDevanagari([c]));
    expect(s.engineOf(0)?.id).toBe('fake-hi');
    expect(s.touchesLocked(c.id)).toBe(true);
    expect(s.tier(c.id)).toBe('review');
  });

  it('a non-spelling suggestion over a command in a Hindi paragraph is hidden, as in English', async () => {
    const text = 'यह एक छोटा सा परीक्षण है और इसे चलाने के लिए यह आदेश दें।\nsudo apt-get install foo';
    const dash = text.indexOf('-');
    const c = candidate(text, { start: dash, end: dash + 1 }, '–', 'Punctuation', 'rules');
    expect(c.original).toBe('-');
    const s = await CheckSession.start(mostlyHindi({ id: 0, text }), opts, withDevanagari([c]));
    expect(s.engineOf(0)?.id).toBe('fake-hi');
    expect(s.tier(c.id)).toBe('hidden');
  });

  it("a user's 'safe' override for Formatting is capped in a Hindi paragraph: asked, not applied, not on the simple-fixes card", async () => {
    const text = 'यह एक छोटा सा  परीक्षण है।';
    const gap = text.indexOf('  ');
    const c = candidate(text, { start: gap, end: gap + 2 }, ' ', 'Formatting', 'rules');
    const s = await CheckSession.start(mostlyHindi({ id: 0, text }), { ...opts, tierOverrides: { Formatting: 'safe' } }, withDevanagari([c]));
    expect(s.engineOf(0)?.id).toBe('fake-hi');
    expect(s.tier(c.id)).toBe('review');
    expect(outcomeOf(s, c.id)).toMatchObject({ status: 'pending', auto: false });
    const { top, more } = s.decisions();
    const card = [...top, ...more].find((d) => d.id === SIMPLE_FIXES_ID);
    expect(card?.candidateIds ?? []).not.toContain(c.id);
  });

  it('a fix over an adapter-locked span in a Hindi paragraph touches locked text', async () => {
    const text = 'यह  एक परीक्षण है।';
    const c = candidate(text, { start: 2, end: 4 }, ' ', 'Formatting', 'rules');
    const s = await CheckSession.start(mostlyHindi({ id: 0, text, locked: [{ start: 0, end: 6 }] }), opts, withDevanagari([c]));
    expect(s.engineOf(0)?.id).toBe('fake-hi');
    expect(s.touchesLocked(c.id)).toBe(true);
    expect(s.tier(c.id)).toBe('review');
  });

  it('English paragraphs keep zero-click fixes', async () => {
    const s = await CheckSession.start([{ id: 0, text: 'We met  on Monday.' }], opts, { linter });
    const fix = s.outcomes().find((o) => o.candidate.original === '  ');
    expect(fix).toBeDefined();
    expect(s.tier(fix!.candidate.id)).toBe('safe');
    expect(fix).toMatchObject({ status: 'applied', auto: true });
  });
});

describe('no edit splits a character', () => {
  /** The real linter, also finding `extra` (an injected candidate on paragraph 0). */
  const linterAlsoFinding = (extra: Candidate): RulesLinter => ({
    get variant() {
      return linter.variant;
    },
    lintParagraphs: async (p, lang) => [...(await linter.lintParagraphs(p, lang)), extra],
    lintSpelling: (p, v) => linter.lintSpelling(p, v),
    addWords: (w) => linter.addWords(w),
    setVariant: (v) => linter.setVariant(v),
  });

  const decidedIds = (s: CheckSession) => {
    const { top, more } = s.decisions();
    return [...top, ...more].flatMap((d) => d.candidateIds);
  };

  it('a fix that ends before a combining accent is never applied, and is reported as unplaceable', async () => {
    const text = 'We ate at the café today.';
    const at = text.indexOf('cafe');
    const c = candidate(text, { start: at, end: at + 4 }, 'café', 'Spelling', 'rules');
    expect(c.original).toBe('cafe');
    const s = await CheckSession.start([{ id: 0, text }], opts, { linter: linterAlsoFinding(c) });
    expect(outcomeOf(s, c.id)).toMatchObject({ status: 'rejected', unplaceable: SPLITS_CHARACTER_REASON, auto: false });
    expect(s.outputText(0)).toBe(text);
    expect(decidedIds(s)).not.toContain(c.id);
  });

  it('the guard is per candidate: a double-space fix in the same paragraph still applies', async () => {
    const text = 'We  ate at the café today.';
    const at = text.indexOf('cafe');
    const c = candidate(text, { start: at, end: at + 4 }, 'café', 'Spelling', 'rules');
    const s = await CheckSession.start([{ id: 0, text }], opts, { linter: linterAlsoFinding(c) });
    expect(outcomeOf(s, c.id)).toMatchObject({ status: 'rejected', unplaceable: SPLITS_CHARACTER_REASON });
    const gap = s.outcomes().find((o) => o.candidate.original === '  ' && o.candidate.source === 'rules');
    expect(gap).toMatchObject({ status: 'applied', auto: true });
  });

  it('a stray joiner between Latin letters is still removed without a click (hygiene keeps meaningful ones itself)', async () => {
    const s = await CheckSession.start([{ id: 0, text: 'ab‍cd' }], opts, { linter });
    const zwj = s.outcomes().find((o) => o.candidate.source === 'hygiene' && o.candidate.original === '‍');
    expect(zwj).toMatchObject({ status: 'applied', auto: true });
    expect(s.outputText(0)).toBe('abcd');
  });

  it('a fix in a Hindi paragraph that ends between a consonant and its vowel sign is unplaceable', async () => {
    const text = 'यह किताब बहुत अच्छी है।';
    const at = text.indexOf('कि');
    const c = candidate(text, { start: at, end: at + 1 }, 'ख', 'Punctuation', 'rules');
    expect(c.original).toBe('क');
    const s = await CheckSession.start(mostlyHindi({ id: 0, text }), opts, withDevanagari([c]));
    expect(s.engineOf(0)?.id).toBe('fake-hi');
    expect(outcomeOf(s, c.id)).toMatchObject({ status: 'rejected', unplaceable: SPLITS_CHARACTER_REASON, auto: false });
    expect(s.outputText(0)).toBe(text);
    expect(decidedIds(s)).not.toContain(c.id);
  });
});
