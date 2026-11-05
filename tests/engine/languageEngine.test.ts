/**
 * Each paragraph is checked by one language engine (#2b): English for paragraphs mostly in Latin letters, the
 * not-checked engine for those mostly in another script (#2a). A second engine plugs in without touching English.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { createEnglishEngine } from '@/engine/englishEngine';
import { notCheckedEngine } from '@/engine/notCheckedEngine';
import { createScriptEngines } from '@/engine/scriptEngines';
import type { LanguageEngine } from '@/engine/languageEngine';
import type { CheckOptions } from '@/engine/sessionTypes';
import { findSharedText } from '@/engine/sharedText';
import type { Paragraph } from '@/engine/types';
import { devanagariEngines, fakeEngine } from '../fixtures/fakeEngines';

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
  it('English proofreads Latin, has case, offers the five variants and has the English trust policy', () => {
    expect(createEnglishEngine(linter).capabilities).toEqual({
      id: 'en',
      proofreads: true,
      variants: ['American', 'British', 'Australian', 'Canadian', 'Indian'],
      hasCase: true,
      script: 'Latin',
      language: 'en',
      trust: { zeroClick: true, safeKinds: 'english', ticks: 'slipDoublings' },
    });
  });

  it('not-checked proofreads nothing and has no script, language, variants or case', () => {
    expect(notCheckedEngine.capabilities).toEqual({
      id: 'none',
      proofreads: false,
      variants: [],
      hasCase: false,
      script: null,
      language: null,
      trust: { zeroClick: false, safeKinds: 'layoutOnly', ticks: 'none' },
    });
  });

  it('not-checked is never trusted with a no-click fix', () => {
    expect(notCheckedEngine.capabilities.trust.zeroClick).toBe(false);
  });

  it('every registered engine (and the test fake) is keyed by its own script', () => {
    const registries = [createScriptEngines(), devanagariEngines(fakeEngine())];
    for (const registry of registries) {
      for (const [script, engine] of registry) expect(engine.capabilities.script).toBe(script);
    }
  });
});

describe('the not-checked engine', () => {
  it('returns no candidates and no unchecked paragraphs', async () => {
    const paras = paragraphs([HINDI, BENGALI]);
    expect(await notCheckedEngine.check(paras, opts, findSharedText(paras, opts.language, new Set()))).toEqual({ found: [], uncheckedParagraphs: [] });
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
    return { engine: fakeEngine({ unchecked, seen }), seen };
  }

  const withDevanagari = (engine: LanguageEngine) => ({ linter, scriptEngines: devanagariEngines(engine) });
  const engineIds = (s: CheckSession) => s.paragraphs().map((p) => s.engineOf(p.id)?.id);

  it('a mostly English document with a Devanagari engine registered: English checks, Hindi is not checked', async () => {
    const { engine, seen } = fakeDevanagari();
    const s = await CheckSession.start(paragraphs(MIXED), opts, withDevanagari(engine));
    expect(seen).toEqual([]);
    expect(engineIds(s)).toEqual(['en', 'none', 'en', 'none']);
    expect(s.otherScriptParagraphs()).toEqual([1, 3]);
    expect(s.proofreadingEngines().map((c) => c.id)).toEqual(['en']);
    expect(new Set(s.candidates().map((c) => c.paraId))).toEqual(new Set([0, 2]));
  });

  const MOSTLY_HINDI = [HINDI, ENGLISH, HINDI, HINDI];

  it('a mostly Hindi document with a Devanagari engine registered: it checks the Hindi paragraphs, English is not checked', async () => {
    const { engine, seen } = fakeDevanagari([2]);
    const s = await CheckSession.start(paragraphs(MOSTLY_HINDI), opts, withDevanagari(engine));
    expect(seen).toEqual([[0, 2, 3]]);
    expect(engineIds(s)).toEqual(['fake-hi', 'none', 'fake-hi', 'fake-hi']);
    // One proofreading engine per document: the English paragraph gets no candidate of any kind.
    expect(s.candidates()).toEqual([]);
    expect(s.otherScriptParagraphs()).toEqual([1]);
    expect(s.proofreadingEngines().map((c) => c.id)).toEqual(['fake-hi']);
    // What the engine could not check is reported as such.
    expect(s.uncheckedParagraphs()).toEqual([2]);
  });

  it('a Hindi document checked by the Hindi engine has checked text', async () => {
    const { engine } = fakeDevanagari();
    const s = await CheckSession.start(paragraphs(MOSTLY_HINDI), opts, withDevanagari(engine));
    expect(s.hasCheckedText()).toBe(true);
  });

  it('Latin words inside a checked Hindi paragraph are a not-checked passage', async () => {
    const { engine } = fakeDevanagari();
    const text = 'यह Kashiro का परीक्षण है';
    const s = await CheckSession.start(paragraphs([text, HINDI, HINDI]), opts, withDevanagari(engine));
    const start = text.indexOf('Kashiro');
    expect(s.uncheckedPassages()).toEqual([{ paraId: 0, span: { start, end: start + 'Kashiro'.length }, kind: 'otherScript' }]);
  });

  it('URLs, email addresses and HTML tags in a checked Hindi paragraph are not passages; a Latin word still is', async () => {
    const { engine } = fakeDevanagari();
    // Enough Hindi that the paragraph stays mostly Devanagari, so the fake engine checks it.
    const text =
      'कृपया पूरा विवरण https://example.com पर देखें या अपने सभी प्रश्न mail@example.com पर लिखें।<br>यह <b>Kashiro</b> का छोटा सा परीक्षण है';
    const s = await CheckSession.start(paragraphs([text, HINDI, HINDI]), opts, withDevanagari(engine));
    expect(s.engineOf(0)?.id).toBe('fake-hi');
    const start = text.indexOf('Kashiro');
    expect(s.uncheckedPassages()).toEqual([{ paraId: 0, span: { start, end: start + 'Kashiro'.length }, kind: 'otherScript' }]);
  });

  it('a foreign sentence the proofreading engine reports is an otherLanguage passage', async () => {
    const sentence = 'Dogs bark at night.';
    const text = `यह एक परीक्षण है। ${sentence} यह दूसरा वाक्य है।`;
    const start = text.indexOf(sentence);
    const span = { start, end: start + sentence.length };
    const engine = fakeEngine({ foreignSentences: new Map([[0, [span]]]) });
    const s = await CheckSession.start(paragraphs([text, HINDI, HINDI]), opts, withDevanagari(engine));
    expect(s.uncheckedPassages()).toEqual([{ paraId: 0, span, kind: 'otherLanguage' }]);
  });

  it('a Hindi document with one English paragraph is not mostly unchecked', async () => {
    const { engine } = fakeDevanagari();
    const s = await CheckSession.start(paragraphs(MOSTLY_HINDI), opts, withDevanagari(engine));
    expect(s.mostlyNotChecked()).toBe(false);
  });

  it('the same document with nothing registered: English checks its paragraph, Hindi is not checked (as before)', async () => {
    const s = await CheckSession.start(paragraphs(MOSTLY_HINDI), opts, { linter });
    expect(engineIds(s)).toEqual(['none', 'en', 'none', 'none']);
    expect(s.otherScriptParagraphs()).toEqual([0, 2, 3]);
    expect(s.proofreadingEngines().map((c) => c.id)).toEqual(['en']);
    expect(new Set(s.candidates().map((c) => c.paraId))).toEqual(new Set([1]));
  });

  it('as many Latin letters as Devanagari ones: English is the document engine', async () => {
    const { engine, seen } = fakeDevanagari();
    const s = await CheckSession.start(paragraphs(['ab', 'कख']), opts, withDevanagari(engine));
    expect(seen).toEqual([]);
    expect(engineIds(s)).toEqual(['en', 'none']);
    expect(s.proofreadingEngines().map((c) => c.id)).toEqual(['en']);
  });

  it('a paragraph mixing Devanagari and Bengali goes by the script with the most letters', async () => {
    const { engine, seen } = fakeDevanagari();
    const mostlyHindi = `${HINDI} আমরা`;
    const mostlyBengali = `${BENGALI} यह`;
    const s = await CheckSession.start(paragraphs([mostlyHindi, mostlyBengali]), opts, {
      linter,
      scriptEngines: devanagariEngines(engine),
    });
    expect(seen).toEqual([[0]]);
    expect([0, 1].map((id) => s.engineOf(id)?.id)).toEqual(['fake-hi', 'none']);
  });

  it('Devanagari has the most letters but no paragraph is mostly Devanagari: English proofreads, as with no engine', async () => {
    const { engine, seen } = fakeDevanagari();
    // Each mixed paragraph has a little more Bengali than Devanagari, so neither is the Devanagari engine's.
    const mixed = `${HINDI} ${BENGALI}`;
    const s = await CheckSession.start(paragraphs([ENGLISH, mixed, mixed]), opts, withDevanagari(engine));
    expect(seen).toEqual([]);
    expect(engineIds(s)).toEqual(['en', 'none', 'none']);
    expect(s.proofreadingEngines().map((c) => c.id)).toEqual(['en']);
    expect(s.candidates().map((c) => c.original)).toContain('teh');
  });

  it('a proofreading engine that reports no foreign sentences has no otherLanguage passage', async () => {
    const { engine } = fakeDevanagari();
    const s = await CheckSession.start(paragraphs(MOSTLY_HINDI), opts, withDevanagari(engine));
    expect(s.proofreadingEngines().map((c) => c.id)).toEqual(['fake-hi']);
    expect(s.uncheckedPassages().filter((p) => p.kind === 'otherLanguage')).toEqual([]);
  });
});
