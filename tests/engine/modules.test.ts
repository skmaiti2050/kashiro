import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEFAULT_MODULES, resolveModules, type ModuleSwitches } from '@/engine/modules';
import type { Decision } from '@/engine/decisions';
import type { Paragraph } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

const ALL_OFF: ModuleSwitches = {
  namesCard: false,
  termsCard: false,
  otherLanguageCard: false,
  betterSuggestions: false,
  aiRewrites: false,
  wordLookup: false,
};

const start = (text: string, modules?: Partial<ModuleSwitches>, over: Partial<CheckOptions> = {}) => {
  const paras: Paragraph[] = text.split('\n\n').map((t, id) => ({ id, text: t }));
  return CheckSession.start(
    paras,
    { preset: 'business', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [], modules, ...over },
    { linter },
  );
};

const allDecisions = (s: CheckSession): Decision[] => [...s.decisions().top, ...s.decisions().more];
const kinds = (s: CheckSession) => allDecisions(s).map((d) => d.kind);
const decisionOf = (s: CheckSession, original: string) => {
  const c = s.candidates().find((x) => x.original === original)!;
  return allDecisions(s).find((d) => d.candidateIds.includes(c.id))!;
};

describe('resolveModules', () => {
  it('turns every optional module on by default except AI rewrites (off until the model is downloaded)', () => {
    expect(resolveModules()).toEqual({
      namesCard: true,
      termsCard: true,
      otherLanguageCard: true,
      betterSuggestions: true,
      aiRewrites: false,
      wordLookup: true,
    });
    expect(resolveModules()).toEqual(DEFAULT_MODULES);
  });

  it('applies the switches given and keeps the defaults for the rest', () => {
    expect(resolveModules({ termsCard: false, aiRewrites: true })).toEqual({ ...DEFAULT_MODULES, termsCard: false, aiRewrites: true });
  });

  it('has no switch for the core protections: unknown keys are ignored', () => {
    const attempt = { factLock: false, harperRules: false, offensiveFilter: false, hygiene: false, codeTokens: false } as Partial<ModuleSwitches>;
    expect(resolveModules(attempt)).toEqual(DEFAULT_MODULES);
    expect(Object.keys(resolveModules(attempt)).sort()).toEqual(Object.keys(DEFAULT_MODULES).sort());
  });
});

describe('module switches: off gives the behaviour from before the module', () => {
  it('a session reports the switches it ran with (defaults when none are given)', async () => {
    expect((await start('Fine text.')).modules).toEqual(DEFAULT_MODULES);
    expect((await start('Fine text.', { termsCard: false })).modules).toEqual({ ...DEFAULT_MODULES, termsCard: false });
  });

  const TERMS = 'The ferrocement tanks hold the rain; the ferrocement walls stay cool, and the ferrocement lids keep out dust.';
  it('terms card off: a repeated unknown word is one ordinary per-word batch', async () => {
    expect(kinds(await start(TERMS))).toContain('terms');
    const s = await start(TERMS, { termsCard: false });
    expect(kinds(s)).not.toContain('terms');
    const d = decisionOf(s, 'ferrocement');
    expect(d.kind).toBe('batch');
    expect(d.id).toMatch(/^batch:word:(Spelling|Typo):ferrocement$/);
    expect(d.candidateIds).toHaveLength(3);
  });

  const NAMES = 'Priya Deshmukh met the farmers of Wadgaon. We could of left sooner.';
  it('names card off: each name is its own per-word decision, ranked after the others (score 0)', async () => {
    expect(kinds(await start(NAMES))).toContain('names');
    const s = await start(NAMES, { namesCard: false });
    expect(kinds(s)).not.toContain('names');
    const names = ['Deshmukh', 'Wadgaon'].map((w) => decisionOf(s, w));
    for (const d of names) {
      expect(d.kind).toBe('single');
      expect(d.score).toBe(0);
    }
    const order = allDecisions(s).map((d) => d.id);
    const couldOf = decisionOf(s, 'could of');
    for (const d of names) expect(order.indexOf(d.id)).toBeGreaterThan(order.indexOf(couldOf.id));
  });

  const ROMANISED = 'It was khub bhalo laglo, ebong kichu cheap. I got teh letter.';
  it('other-languages card off: the romanised words are ordinary per-word decisions', async () => {
    expect(kinds(await start(ROMANISED))).toContain('otherLanguage');
    const s = await start(ROMANISED, { otherLanguageCard: false });
    expect(kinds(s)).not.toContain('otherLanguage');
    for (const w of ['khub', 'bhalo', 'laglo', 'ebong', 'kichu']) expect(decisionOf(s, w).kind).toBe('single');
  });

  it('other-languages card off: no word in a mostly foreign sentence is auto-fixed (that protection needs no model)', async () => {
    const s = await start('ami kal school te jabo.', { otherLanguageCard: false });
    const te = s.candidates().find((c) => c.original === 'te')!;
    expect(te.replacements).toContain('the');
    expect(s.tier(te.id)).toBe('review');
    expect(s.outcomes().filter((o) => o.auto && o.status === 'applied')).toEqual([]);
  });

  it("better suggestions off: Harper's own suggestions, in Harper's order", async () => {
    const text = 'The recods were filed. Our team arived late. Litle by litle.';
    const raw = await linter.lintParagraphs([{ id: 0, text }], 'plaintext');
    const s = await start(text, { betterSuggestions: false });
    for (const word of ['recods', 'arived', 'litle']) {
      const rawFlag = raw.find((c) => c.original === word)!;
      const flag = s.candidates().find((c) => c.original === word)!;
      expect(flag.replacements).toEqual(rawFlag.replacements);
      expect(flag.linterReplacements).toBeUndefined();
    }
    // With the module on, the list changes ("arived" gains "arrived").
    const on = await start(text);
    expect(on.candidates().find((c) => c.original === 'arived')!.replacements[0]).toBe('arrived');
  });
});

describe('core protections stay on with every module off', () => {
  it('offensive suggestions are still filtered', async () => {
    const text = 'Sujit arived late.';
    const raw = await linter.lintParagraphs([{ id: 0, text }], 'plaintext');
    expect(raw.find((c) => c.original === 'Sujit')!.replacements).toContain('Shit');
    const s = await start(text, ALL_OFF);
    expect(s.candidates().find((c) => c.original === 'Sujit')!.replacements).not.toContain('Shit');
  });

  it('Harper rules, hygiene, the fact lock and code-token handling all still apply', async () => {
    const text = 'I think teh cat is is here.​ He wrote "recieve" in 2024. Call preventDefault now.';
    const off = await start(text, ALL_OFF);
    const on = await start(text);
    const summary = (s: CheckSession) =>
      s.candidates().map((c) => ({ original: c.original, kind: c.kind, tier: s.tier(c.id), locked: s.touchesLocked(c.id) }));
    expect(summary(off)).toEqual(summary(on));
    expect(off.outputText(0)).toBe(on.outputText(0));
    const quoted = off.candidates().find((c) => c.original === 'recieve')!;
    expect(off.touchesLocked(quoted.id)).toBe(true);
    expect(off.tier(quoted.id)).toBe('review');
    expect(off.candidates().some((c) => c.source === 'hygiene')).toBe(true);
    const code = off.candidates().filter((c) => c.original === 'preventDefault');
    for (const c of code) expect(off.tier(c.id)).toBe('hidden');
    expect(off.outputText(0)).toContain('I think the cat is here.');
  });
});
