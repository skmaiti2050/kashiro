/**
 * Each paragraph is checked by one language engine (#2b): English for paragraphs mostly in Latin letters, the
 * not-checked engine for those mostly in another script (#2a). A second engine plugs in without touching English.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { createEnglishEngine } from '@/engine/englishEngine';
import { notCheckedEngine } from '@/engine/notCheckedEngine';
import type { LanguageEngine } from '@/engine/languageEngine';
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
      nameKey: 'toolbar.english',
      variants: ['American', 'British', 'Australian', 'Canadian', 'Indian'],
      hasCase: true,
    });
  });

  it('not-checked proofreads nothing and has no name, variants or case', () => {
    expect(notCheckedEngine.capabilities).toEqual({ id: 'none', proofreads: false, nameKey: null, variants: [], hasCase: false });
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

  it('an engine passed in deps checks the other-script paragraphs, and only those', async () => {
    const seen: number[][] = [];
    const fake: LanguageEngine = {
      capabilities: { id: 'fake', proofreads: true, nameKey: null, variants: ['Standard'], hasCase: false },
      check: async (paras) => {
        seen.push(paras.map((p) => p.id));
        return { found: [], uncheckedParagraphs: [3] };
      },
      addWords: async () => {},
    };
    const s = await CheckSession.start(paragraphs(MIXED), opts, { linter, otherScriptEngine: fake });
    expect(seen).toEqual([[1, 3]]);
    expect(s.engineOf(1)?.id).toBe('fake');
    expect(s.engineOf(0)?.id).toBe('en');
    // A proofreading engine's paragraphs are not "not checked"; what it could not check is reported as such.
    expect(s.otherScriptParagraphs()).toEqual([]);
    expect(s.uncheckedParagraphs()).toEqual([3]);
  });
});
