import { describe, it, expect } from 'vitest';
import { adapterFor } from '@/formats/registry';
import { textParagraphStarts } from '@/formats/text';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);
const txt = adapterFor('a.txt')!;

describe('text adapter', () => {
  it('splits into blank-line separated paragraphs with exact offsets', async () => {
    const src = 'one two\nstill one\n\n  \nthree\r\n\r\nfour';
    const { paras, handle } = await txt.read(enc(src));
    expect(paras.map((p) => p.text)).toEqual(['one two\nstill one', 'three', 'four']);
    // round-trip: replace each paragraph's first word
    const edits = paras.map((p) => ({ paraId: p.id, span: { start: 0, end: 1 }, replacement: 'X' }));
    const { bytes, unplaceable } = await txt.write(handle, edits, 'tracked');
    expect(unplaceable).toEqual([]);
    expect(dec(bytes)).toBe('Xne two\nstill one\n\n  \nXhree\r\n\r\nXour');
  });

  it('keeps BOM and CRLF; only teh -> the changes', async () => {
    const src = '﻿First teh line\r\nsecond line\r\n\r\nNext para.\r\n';
    const { paras, handle } = await txt.read(enc(src));
    expect(paras[0].text).toBe('First teh line\r\nsecond line');
    const i = paras[0].text.indexOf('teh');
    const { bytes } = await txt.write(handle, [{ paraId: 0, span: { start: i, end: i + 3 }, replacement: 'the' }], 'clean');
    expect(dec(bytes)).toBe(src.replace('teh', 'the'));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('applies several edits in one paragraph right-to-left', async () => {
    const { handle } = await txt.read(enc('aa bb cc'));
    const { bytes } = await txt.write(
      handle,
      [
        { paraId: 0, span: { start: 0, end: 2 }, replacement: 'AAA' },
        { paraId: 0, span: { start: 6, end: 8 }, replacement: 'C' },
      ],
      'clean',
    );
    expect(dec(bytes)).toBe('AAA bb C');
  });

  it('rejects bytes that are not UTF-8', async () => {
    await expect(txt.read(new Uint8Array([0x68, 0xe9, 0x6c, 0x6c, 0x6f]))).rejects.toThrow('not UTF-8 text');
  });

  it('ignores mode (always clean)', async () => {
    const { handle } = await txt.read(enc('teh'));
    const e = [{ paraId: 0, span: { start: 0, end: 3 }, replacement: 'the' }];
    const a = await txt.write(handle, e, 'tracked');
    const b = await txt.write(handle, e, 'clean');
    expect(dec(a.bytes)).toBe('the');
    expect(a.bytes).toEqual(b.bytes);
  });

  it('reports out-of-range edits as unplaceable', async () => {
    const { handle } = await txt.read(enc('abc'));
    const r = await txt.write(handle, [{ paraId: 3, span: { start: 0, end: 1 }, replacement: 'x' }], 'clean');
    expect(r.unplaceable).toHaveLength(1);
  });

  it('handles an empty file and a BOM-only file', async () => {
    const empty = await txt.read(enc(''));
    expect(empty.paras).toEqual([]);
    expect((await txt.write(empty.handle, [], 'clean')).bytes).toEqual(new Uint8Array());
    const bom = await txt.read(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(bom.paras).toEqual([]);
    expect([...(await txt.write(bom.handle, [], 'clean')).bytes]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('edits the second paragraph of a CRLF file, with and without trailing blank lines', async () => {
    for (const tail of ['', '\r\n', '\r\n\r\n  \r\n']) {
      const src = 'First para.\r\n\r\nSecond teh para.\r\nline two' + tail;
      const { paras, handle } = await txt.read(enc(src));
      expect(paras).toHaveLength(2);
      expect(paras[1].text).toBe('Second teh para.\r\nline two');
      const i = paras[1].text.indexOf('teh');
      const { bytes } = await txt.write(handle, [{ paraId: 1, span: { start: i, end: i + 3 }, replacement: 'the' }], 'clean');
      expect(dec(bytes)).toBe(src.replace('teh', 'the'));
    }
  });

  it('markdown: blank lines inside a fenced code block do not split it', async () => {
    const md = adapterFor('a.md')!;
    const fence = '```python\ndef f():\n\n    return 1\n```';
    const tilde = '~~~\na\n\nb\n~~~';
    const { paras } = await md.read(enc(`Intro.\n\n${fence}\n\n${tilde}\n\nAfter.`));
    expect(paras.map((p) => p.text)).toEqual(['Intro.', fence, tilde, 'After.']);
  });

  it('markdown: an unclosed fence runs to the end; plain text ignores fences', async () => {
    const md = adapterFor('a.md')!;
    expect((await md.read(enc('```\na\n\nb'))).paras.map((p) => p.text)).toEqual(['```\na\n\nb']);
    expect((await txt.read(enc('```\na\n\nb\n```'))).paras.map((p) => p.text)).toEqual(['```\na', 'b\n```']);
  });

  // Task U3 fix 1: a 2,000-row table as one paragraph took ~40 s to check. Cells are what the linter's own
  // Markdown parser checks one by one, so each is its own paragraph; the delimiter row holds no text.
  it('markdown: each table cell is its own paragraph, the delimiter row none, with exact offsets', async () => {
    const md = adapterFor('a.md')!;
    const src = 'Intro.\n\n| Name | Notes |\r\n|---|:--:|\r\n| alpha one | teh value |\r\n|  | a \\| b |\n\nAfter.';
    const { paras, handle } = await md.read(enc(src));
    expect(paras.map((p) => p.text)).toEqual(['Intro.', 'Name', 'Notes', 'alpha one', 'teh value', 'a \\| b', 'After.']);
    const starts = textParagraphStarts(handle);
    for (const p of paras) expect(src.slice(starts.get(p.id)!, starts.get(p.id)! + p.text.length)).toBe(p.text);
    const teh = paras.find((p) => p.text === 'teh value')!;
    const { bytes } = await md.write(handle, [{ paraId: teh.id, span: { start: 0, end: 3 }, replacement: 'the' }], 'clean');
    expect(dec(bytes)).toBe(src.replace('teh', 'the'));
  });

  it('markdown: a table needs its delimiter row and ends at a blank line or a line without a pipe', async () => {
    const md = adapterFor('a.md')!;
    const read = async (src: string) => (await md.read(enc(src))).paras.map((p) => p.text);
    expect(await read('a | b\n--|--\nc | d\nplain line')).toEqual(['a', 'b', 'c', 'd', 'plain line']);
    expect(await read('x | y\nmore text')).toEqual(['x | y\nmore text']);
    expect(await read('```\n| a | b |\n|---|---|\n```')).toEqual(['```\n| a | b |\n|---|---|\n```']);
    expect((await txt.read(enc('| a | b |\n|---|---|\n| c | d |'))).paras.map((p) => p.text)).toEqual(['| a | b |\n|---|---|\n| c | d |']);
  });

  it('paragraph starts come from the read itself (indents, CRLF, blank lines with spaces, BOM)', async () => {
    const text = '  Hello there.\r\n  \r\n\r\n  Hello there.\r\nsecond line\n\n\tLast';
    const { handle } = await txt.read(enc(text));
    expect([...textParagraphStarts(handle).values()]).toEqual([0, 22, 51]);
    const bom = await txt.read(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('A.\n\nB.')]));
    expect([...textParagraphStarts(bom.handle).values()]).toEqual([0, 4]);
    const fence = await adapterFor('a.md')!.read(enc('# Title\n\n```\na\n\nb\n```\n\nEnd.'));
    expect([...textParagraphStarts(fence.handle).values()]).toEqual([0, 9, 23]);
  });

  it('registry: language and extensions', () => {
    expect(adapterFor('x.MD')!.language).toBe('markdown');
    expect(adapterFor('x.markdown')!.language).toBe('markdown');
    expect(adapterFor('x.txt')!.language).toBe('plaintext');
    expect(adapterFor('x.docx')!.exts).toEqual(['.docx']);
    expect(adapterFor('x.doc')).toBeNull();
    expect(adapterFor('noext')).toBeNull();
  });
});
