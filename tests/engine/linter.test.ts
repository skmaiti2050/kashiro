import { describe, it, expect } from 'vitest';
import { createLinter } from '@/engine/linter';

const para = (text: string, id = 0) => ({ id, text });

describe('createLinter', () => {
  it('reports agreement and grammar candidates with replacements', async () => {
    const l = await createLinter('American');
    const c = await l.lintParagraphs([para('I has went their.')], 'plaintext');
    const agr = c.find((x) => x.kind === 'Agreement');
    const gra = c.find((x) => x.kind === 'Grammar');
    expect(agr?.original).toBe('has');
    expect(agr?.replacements).toEqual(['have']);
    expect(gra?.original).toBe('went');
    expect(gra?.replacements).toEqual(['gone']);
  });

  it('keeps UTF-16 offsets correct after an emoji', async () => {
    const l = await createLinter('American');
    const text = 'Priya said 😀 that their is';
    const c = await l.lintParagraphs([para(text, 7)], 'plaintext');
    const t = c.find((x) => x.original === 'their');
    expect(t).toBeDefined();
    expect(text.slice(t!.span.start, t!.span.end)).toBe('their');
    expect(t!.paraId).toBe(7);
    expect(t!.id).toBe(`7:${t!.span.start}:${t!.span.end}:${t!.kind}`);
    expect(t!.source).toBe('rules');
  });

  it('addWords removes the spelling candidate', async () => {
    const l = await createLinter('American');
    const text = 'Sujit went home.';
    const before = await l.lintParagraphs([para(text)], 'plaintext');
    expect(before.some((x) => x.kind === 'Spelling' && x.original === 'Sujit')).toBe(true);
    await l.addWords(['Sujit']);
    const after = await l.lintParagraphs([para(text)], 'plaintext');
    expect(after.some((x) => x.kind === 'Spelling')).toBe(false);
  });

  it('markdown mode ignores inline code', async () => {
    const l = await createLinter('American');
    const c = await l.lintParagraphs([para('Use `teh` here.')], 'markdown');
    expect(c.some((x) => x.original === 'teh')).toBe(false);
  });

  it('setVariant switches dialect', async () => {
    const l = await createLinter('American');
    const text = 'The colour is nice.';
    const us = await l.lintParagraphs([para(text)], 'plaintext');
    expect(us.some((x) => x.original === 'colour')).toBe(true);
    await l.setVariant('British');
    const uk = await l.lintParagraphs([para(text)], 'plaintext');
    expect(uk.some((x) => x.original === 'colour')).toBe(false);
  });

  it('lintSpelling flags only spelling, under the given variant, and leaves the current variant', async () => {
    const l = await createLinter('American');
    await l.addWords(['Sujit']);
    const text = 'Sujit said the colour of teh car is is red.';
    const us = await l.lintSpelling([para(text)], 'American');
    expect(us.map((x) => x.original)).toContain('colour');
    expect(us.some((x) => x.original === 'Sujit' || x.original === 'is is')).toBe(false);
    const uk = await l.lintSpelling([para(text)], 'British');
    expect(uk.some((x) => x.original === 'colour')).toBe(false);
    expect(l.variant).toBe('American');
  });

  it('keeps added words across setVariant', async () => {
    const l = await createLinter('American');
    await l.addWords(['Sujit']);
    await l.setVariant('British');
    await l.setVariant('American');
    const c = await l.lintParagraphs([{ id: 0, text: 'Sujit went home.' }], 'plaintext');
    expect(c.filter((x) => x.kind === 'Spelling')).toHaveLength(0);
  });
});

describe('Indian-English word list', () => {
  it.each(['American', 'British', 'Indian'] as const)('knows common Indian-English words under %s', async (v) => {
    const l = await createLinter(v);
    const text =
      'The sarpanch of the gram panchayat met the tehsildar about the borewells, the nullah and two lakh rupees. ' +
      'We ate dal, roti, poha and theplas at a dhaba near the godown, then preponed the meeting.';
    const spelling = (await l.lintParagraphs([para(text)], 'plaintext')).filter((x) => x.kind === 'Spelling' || x.kind === 'Typo');
    expect(spelling.map((x) => x.original)).toEqual([]);
  });

  it('still flags real misspellings', async () => {
    const l = await createLinter('Indian');
    const c = await l.lintParagraphs([para('The goverment recieved it.')], 'plaintext');
    expect(c.map((x) => x.original)).toEqual(expect.arrayContaining(['goverment', 'recieved']));
  });
});

describe('EN_IN_WORDS list', () => {
  it('is a plain sorted list of 600-800 unique lowercase words', async () => {
    const { EN_IN_WORDS } = await import('@/engine/wordlists/en-IN');
    expect(EN_IN_WORDS.length).toBeGreaterThanOrEqual(600);
    expect(EN_IN_WORDS.length).toBeLessThanOrEqual(800);
    expect(new Set(EN_IN_WORDS).size).toBe(EN_IN_WORDS.length);
    expect([...EN_IN_WORDS].sort()).toEqual(EN_IN_WORDS);
    for (const w of EN_IN_WORDS) expect(w).toMatch(/^\p{Ll}[\p{Ll}-]*$/u);
  });
});
