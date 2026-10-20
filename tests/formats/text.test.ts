import { describe, it, expect } from 'vitest';
import { adapterFor } from '@/formats/registry';

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

  it('registry: language and extensions', () => {
    expect(adapterFor('x.MD')!.language).toBe('markdown');
    expect(adapterFor('x.markdown')!.language).toBe('markdown');
    expect(adapterFor('x.txt')!.language).toBe('plaintext');
    expect(adapterFor('x.docx')).toBeNull();
    expect(adapterFor('noext')).toBeNull();
  });
});
