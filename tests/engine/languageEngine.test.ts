/**
 * Each paragraph is checked by one language engine (#2b): English for paragraphs mostly in Latin letters, the
 * not-checked engine for those mostly in another script (#2a). A second engine plugs in without touching English.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { createEnglishEngine } from '@/engine/englishEngine';
import { notCheckedEngine } from '@/engine/notCheckedEngine';
import type { EngineId, LanguageEngine } from '@/engine/languageEngine';
import type { CheckOptions } from '@/engine/sessionTypes';
import type { Paragraph } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts: CheckOptions = { preset: 'business', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] };
const paragraphs = (texts: string[]): Paragraph[] => texts.map((text, id) => ({ id, text }));

const ENGLISH = 'We met on teh Monday.';
const HINDI = 'यह एक परीक्षण है।';
const ENGLISH_2 = 'She recieved the letter.';
const BENGALI = 'আমরা কাল বাজারে গিয়েছিলাম।';
const MIXED = [ENGLISH, HINDI, ENGLISH_2, BENGALI];

describe('engine capabilities', () => {
  it('English proofreads, has case and offers the five variants', () => {
    expect(createEnglishEngine(linter).capabilities).toEqual({
      id: 'en',
      proofreads: true,
      variants: ['American', 'British', 'Australian', 'Canadian', 'Indian'],
      hasCase: true,
    });
  });

  it('not-checked proofreads nothing and has no variants or case', () => {
    expect(notCheckedEngine.capabilities).toEqual({ id: 'none', proofreads: false, variants: [], hasCase: false });
  });
});

describe('the not-checked engine', () => {
  it('returns no candidates and no unchecked paragraphs', async () => {
    expect(await notCheckedEngine.check(paragraphs([HINDI, BENGALI]), opts)).toEqual({ found: [], uncheckedParagraphs: [] });
  });
});

describe('routing paragraphs to engines', () => {
  it('a mixed document: English paragraphs to English, Hindi and Bengali to not-checked', async () => {
    const s = await CheckSession.start(paragraphs(MIXED), opts, { linter });
    expect([0, 1, 2, 3].map((id) => s.engineOf(id)?.id)).toEqual(['en', 'none', 'en', 'none']);
    expect(s.otherScriptParagraphs()).toEqual([1, 3]);
    expect(new Set(s.candidates().map((c) => c.paraId))).toEqual(new Set([0, 2]));
  });

  /** A fake Devanagari engine that records the paragraphs it is given and reports `unchecked` as not checked. */
  function fakeDevanagari(unchecked: number[] = []) {
    const seen: number[][] = [];
    const engine: LanguageEngine = {
      capabilities: { id: 'fake-hi' as EngineId, proofreads: true, variants: ['Standard'], hasCase: false },
      check: async (paras) => {
        seen.push(paras.map((p) => p.id));
        return { found: [], uncheckedParagraphs: unchecked };
      },
      addWords: async () => {},
    };
    return { engine, seen };
  }

  it('an engine registered for Devanagari checks the Hindi paragraph; Bengali stays not-checked', async () => {
    const { engine, seen } = fakeDevanagari([1]);
    const s = await CheckSession.start(paragraphs(MIXED), opts, { linter, scriptEngines: new Map([['Devanagari', engine]]) });
    expect(seen).toEqual([[1]]);
    expect([0, 1, 2, 3].map((id) => s.engineOf(id)?.id)).toEqual(['en', 'fake-hi', 'en', 'none']);
    // A proofreading engine's paragraphs are not "not checked"; what it could not check is reported as such.
    expect(s.otherScriptParagraphs()).toEqual([3]);
    expect(s.uncheckedParagraphs()).toEqual([1]);
  });

  it('a paragraph mixing Devanagari and Bengali goes by the script with the most letters', async () => {
    const { engine, seen } = fakeDevanagari();
    const mostlyHindi = `${HINDI} আমরা`;
    const mostlyBengali = `${BENGALI} यह`;
    const s = await CheckSession.start(paragraphs([mostlyHindi, mostlyBengali]), opts, {
      linter,
      scriptEngines: new Map([['Devanagari', engine]]),
    });
    expect(seen).toEqual([[0]]);
    expect([0, 1].map((id) => s.engineOf(id)?.id)).toEqual(['fake-hi', 'none']);
  });
});
