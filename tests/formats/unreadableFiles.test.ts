/**
 * Broken or unexpected files (Task U3 item 10): each is refused with a FileProblem the UI can explain in plain
 * words, never a crash or a hang. Markdown that is merely malformed still opens and checks.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { adapterFor } from '@/formats/registry';
import { UnreadableFileError, type FileProblem } from '@/formats/fileProblems';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { buildDocx } from '../fixtures/make_docx';

const FIXTURES = path.resolve(__dirname, '../fixtures/files');
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
const encode = (s: string) => new TextEncoder().encode(s);

/** The FileProblem `name`'s adapter refuses `bytes` with, or 'read' when it reads them. */
async function problemOf(name: string, bytes: Uint8Array): Promise<FileProblem | 'read'> {
  try {
    await adapterFor(name)!.read(bytes);
    return 'read';
  } catch (e) {
    if (e instanceof UnreadableFileError) return e.problem;
    throw e;
  }
}

const SIMPLE_BODY = '<w:p><w:r><w:t>Hello there.</w:t></w:r></w:p>';

async function zipWith(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** UTF-16 code units of `s`, little- or big-endian, with an optional byte-order mark. */
function utf16(s: string, littleEndian: boolean, bom: boolean): Uint8Array {
  const units = [...(bom ? [0xfeff] : []), ...[...s].map((ch) => ch.charCodeAt(0))];
  const out = new Uint8Array(units.length * 2);
  units.forEach((u, i) => {
    out[2 * i + (littleEndian ? 0 : 1)] = u & 0xff;
    out[2 * i + (littleEndian ? 1 : 0)] = u >> 8;
  });
  return out;
}

describe('.docx files that are not what they claim', () => {
  it('a truncated .docx is damaged', async () => {
    const whole = await buildDocx(SIMPLE_BODY);
    expect(await problemOf('a.docx', whole.slice(0, Math.floor(whole.length / 2)))).toBe('damaged');
  });

  it('a .docx whose document.xml is cut short is damaged', async () => {
    const whole = await buildDocx(SIMPLE_BODY);
    const zip = await JSZip.loadAsync(whole);
    const xml = await zip.file('word/document.xml')!.async('string');
    zip.file('word/document.xml', xml.slice(0, xml.indexOf('</w:t>')));
    expect(await problemOf('a.docx', await zip.generateAsync({ type: 'uint8array' }))).toBe('damaged');
  });

  it('a zip without word/document.xml is not a Word document', async () => {
    expect(await problemOf('a.docx', await zipWith({ 'readme.txt': 'hello' }))).toBe('notWord');
  });

  it('plain text renamed to .docx is not a Word document', async () => {
    expect(await problemOf('a.docx', encode('just some text'))).toBe('notWord');
  });

  it('a password-protected .docx (saved by Word with a password) is encrypted', async () => {
    expect(await problemOf('a.docx', fixture('encrypted.docx'))).toBe('encrypted');
  });

  it('an old Word .doc renamed to .docx is reported as an old Word file', async () => {
    expect(await problemOf('a.docx', fixture('old-word-renamed.docx'))).toBe('oldWord');
  });

  it('an empty .docx (0 bytes) is empty', async () => {
    expect(await problemOf('a.docx', new Uint8Array())).toBe('empty');
  });
});

describe('text files that are not UTF-8 text', () => {
  it.each([
    ['UTF-16 little-endian with a byte-order mark', utf16('Hello there.', true, true)],
    ['UTF-16 big-endian with a byte-order mark', utf16('Hello there.', false, true)],
    ['UTF-16 little-endian without a byte-order mark', utf16('Hello there, this is plain text.', true, false)],
  ])('%s is UTF-16', async (_, bytes) => {
    expect(await problemOf('a.txt', bytes)).toBe('utf16');
  });

  it('Windows-1252 text ("café" with byte E9) is not UTF-8', async () => {
    expect(await problemOf('a.txt', new Uint8Array([...encode('The caf'), 0xe9, ...encode(' was open.')]))).toBe('notUtf8');
  });

  it('a binary file renamed to .txt is binary', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0]);
    expect(await problemOf('a.txt', png)).toBe('binary');
  });

  it('a Word document renamed to .md is binary', async () => {
    expect(await problemOf('a.md', await buildDocx(SIMPLE_BODY))).toBe('binary');
  });

  it('an empty .txt still reads (as no paragraphs): the open path reports it', async () => {
    expect(await problemOf('a.txt', new Uint8Array())).toBe('read');
  });
});

describe('malformed Markdown still opens and checks, unchanged', () => {
  let linter: RulesLinter;
  beforeAll(async () => {
    linter = await createLinter('American');
  });

  // 500 rows keep the suite quick; the 2,000-row check time is a timing test (tests/timing, Task U3 fix 1).
  const table = ['| a | b | c |', '|---|---|---|', ...Array.from({ length: 500 }, (_, i) => `| row ${i} | teh value | ${i * 3} |`)].join('\n');
  it.each([
    ['an unclosed code fence', 'Intro text here.\n\n```js\nconst x = 1;\n\nMore text that teh fence swallowed.\n'],
    ['an HTML block', 'Before.\n\n<div class="x">\n<p>Some <b>bold</b> teh text</p>\n</div>\n\nAfter teh block.\n'],
    ['a 500-row table', table],
  ])('%s', async (_, text) => {
    const adapter = adapterFor('a.md')!;
    const bytes = encode(text);
    const { paras, handle } = await adapter.read(bytes);
    await CheckSession.start(paras, { preset: 'blog', fallbackVariant: 'American', language: 'markdown', dictionary: [] }, { linter });
    const { bytes: out } = await adapter.write(handle, [], 'clean');
    expect(out).toEqual(bytes);
  });
});
