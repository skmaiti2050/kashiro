/**
 * #1 gate 1: a paragraph another engine checks gets the same never-damage locks as an English one, and nothing
 * there is applied without a click until that language has its own tier policy (gate 9).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { EngineId, LanguageEngine } from '@/engine/languageEngine';
import type { CheckOptions } from '@/engine/sessionTypes';
import type { Candidate, Paragraph, Span } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts: CheckOptions = { preset: 'business', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] };

const ENGLISH = 'We met on teh Monday.';
const HINDI = 'यह एक परीक्षण है।';

/** MOSTLY_HINDI from languageEngine.test.ts, with `first` as paragraph 0 (the one the fake candidate is on). */
const mostlyHindi = (first: Paragraph): Paragraph[] => [first, ...[ENGLISH, HINDI, HINDI].map((text, i) => ({ id: i + 1, text }))];

/** A fake Devanagari engine that returns the given candidates. */
function fakeDevanagari(found: Candidate[]): LanguageEngine {
  return {
    capabilities: { id: 'fake-hi' as EngineId, proofreads: true, variants: ['Standard'], hasCase: false },
    check: async () => ({ found, uncheckedParagraphs: [] }),
    addWords: async () => {},
  };
}

const withDevanagari = (found: Candidate[]) => ({ linter, scriptEngines: new Map([['Devanagari', fakeDevanagari(found)]]) });

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
