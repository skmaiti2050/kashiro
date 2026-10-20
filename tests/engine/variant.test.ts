import { describe, it, expect } from 'vitest';
import { detectVariant } from '@/engine/variant';
import { createLinter } from '@/engine/linter';

const para = (text: string, id = 0) => ({ id, text });

describe('detectVariant', () => {
  it('detects non-American for -our/-ise spellings', async () => {
    const r = await detectVariant([para('The colour of the organised behaviour')], 'American');
    expect(r.variant).not.toBe('American');
  });

  it('detects American for -or/-ize spellings', async () => {
    const r = await detectVariant([para('The color of the organized behavior')], 'British');
    expect(r.variant).toBe('American');
    expect(r.mixed).toBe(false);
  });

  it('flags mixed when both colour and color appear', async () => {
    const r = await detectVariant([para('The colour and the color')], 'American');
    expect(r.mixed).toBe(true);
    expect(r.variantWords.size).toBeGreaterThan(0);
    expect(r.variantWords.has(r.variant === 'American' ? 'colour' : 'color')).toBe(true);
  });

  it('returns the fallback when there are no variant-specific words', async () => {
    for (const fb of ['Canadian', 'Indian', 'American'] as const) {
      const r = await detectVariant([para('The cat sat on the mat.')], fb);
      expect(r.variant).toBe(fb);
      expect(r.mixed).toBe(false);
    }
  });

  it('never treats a typo as a variant word', async () => {
    const r = await detectVariant([para('The colour of teh thing, and the color too')], 'American');
    expect(r.variantWords.has('teh')).toBe(false);
    expect([...r.variantWords].some((w) => w === 'colour' || w === 'color')).toBe(true);
  });

  it('restores the variant of a shared linter', async () => {
    const linter = await createLinter('Indian');
    await detectVariant([para('The color of the organised behaviour')], 'Indian', { linter });
    expect(linter.variant).toBe('Indian');
  });

  it('keeps the personal dictionary on a shared linter', async () => {
    const linter = await createLinter('American');
    await linter.addWords(['Sujit']);
    await detectVariant([para('The colour of it.')], 'American', { linter });
    const c = await linter.lintParagraphs([para('Sujit went home.')], 'plaintext');
    expect(c.filter((x) => x.kind === 'Spelling')).toHaveLength(0);
  });
});
