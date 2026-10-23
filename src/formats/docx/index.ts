/**
 * .docx adapter. Only word/document.xml is read and rewritten. Headers, footers, footnotes, endnotes and
 * comments are preserved byte-for-byte but NOT checked in v1.0 (the UI says so).
 */
import JSZip from 'jszip';
import type { FormatAdapter } from '../types';
import { extractDocx, type DocxPara } from './extract';
import { writeDocumentXml } from './write';
import { compoundFileProblem, startsWith, UnreadableFileError, ZIP_MAGIC } from '../fileProblems';

const DOCUMENT = 'word/document.xml';

interface DocxHandle {
  /** The original file; each write reloads it, so a handle can be written any number of times. */
  bytes: Uint8Array;
  xml: string;
  paras: DocxPara[];
}

async function load(bytes: Uint8Array): Promise<{ zip: JSZip; doc: JSZip.JSZipObject }> {
  if (bytes.length === 0) throw new UnreadableFileError('empty', 'the file is empty');
  const compound = compoundFileProblem(bytes);
  if (compound) throw compound;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    if (startsWith(bytes, ZIP_MAGIC)) throw new UnreadableFileError('damaged', 'the Word document is damaged or incomplete');
    throw new UnreadableFileError('notWord', 'not a Word document (not a zip package)');
  }
  const doc = zip.file(DOCUMENT);
  if (!doc) throw new UnreadableFileError('notWord', `not a Word document (${DOCUMENT} missing)`);
  return { zip, doc };
}

/** The paragraphs of word/document.xml; a part that can't be unpacked or parsed is a damaged file. */
async function readParagraphs(doc: JSZip.JSZipObject): Promise<{ xml: string; paras: DocxPara[] }> {
  try {
    const xml = await doc.async('string');
    return { xml, paras: extractDocx(xml, 0) };
  } catch (e) {
    throw new UnreadableFileError('damaged', `the Word document is damaged: ${(e as Error).message}`);
  }
}

export function createDocxAdapter(opts: { now?: () => Date } = {}): FormatAdapter {
  const now = opts.now ?? (() => new Date());
  return {
    exts: ['.docx'],
    language: 'plaintext',
    async read(bytes) {
      const { doc } = await load(bytes);
      const { xml, paras } = await readParagraphs(doc);
      const handle: DocxHandle = { bytes, xml, paras };
      return { paras: paras.map((d) => d.para), handle };
    },
    async write(h, edits, mode) {
      const handle = h as DocxHandle;
      const res = writeDocumentXml(handle.xml, handle.paras, edits, mode, now());
      if (res.xml === handle.xml) return { bytes: handle.bytes, unplaceable: res.unplaceable };
      const { zip, doc } = await load(handle.bytes);
      // Unchanged entries keep their compressed bytes: JSZip reuses the stored data when the entry's
      // compression matches the one requested, so STORE entries are pinned to STORE (others DEFLATE).
      zip.forEach((_, file) => {
        const data = (file as unknown as { _data?: { compression?: { magic?: string } } })._data;
        if (data?.compression?.magic === '\x00\x00') (file as unknown as { options: { compression: string } }).options.compression = 'STORE';
      });
      // Re-adding an existing name keeps its position in the entry order.
      zip.file(DOCUMENT, res.xml, { compression: 'DEFLATE', date: doc.date });
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      return { bytes, unplaceable: res.unplaceable };
    },
  };
}

export const docxAdapter = createDocxAdapter();
