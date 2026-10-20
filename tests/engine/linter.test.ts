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

  it('keeps added words across setVariant', async () => {
    const l = await createLinter('American');
    await l.addWords(['Sujit']);
    await l.setVariant('British');
    await l.setVariant('American');
    const c = await l.lintParagraphs([{ id: 0, text: 'Sujit went home.' }], 'plaintext');
    expect(c.filter((x) => x.kind === 'Spelling')).toHaveLength(0);
  });
});
