import type { Paragraph } from '@/engine/types';
import type { FormatAdapter } from '@/formats/types';
import { msg, type Message } from '../i18n/message';
import { joinParagraphs, paragraphStarts } from './documentText';

export interface OpenDocument {
  /** New for every opened file or paste, so the editor knows when to replace its content. */
  id: number;
  name: string;
  path: string | null;
  /** The text in the document view: the file's text, or a .docx's paragraphs separated by blank lines. */
  text: string;
  /**
   * The line break the editor splits and joins lines with, so its text round-trips exactly: CRLF for
   * a file that uses only CRLF, LF otherwise (a mixed file keeps its stray CRs inside the lines).
   */
  lineSeparator: '\n' | '\r\n';
  /** Plain text and Markdown can be edited in place; .docx is read-only. */
  editable: boolean;
  /** Paragraph id → its start offset in `text`. */
  paraStarts: Map<number, number>;
  /** A short note about what this format leaves unchecked. */
  note: Message | null;
}

/** What the controller keeps of a read file, to check it and to write it back. */
export interface LoadedFile {
  adapter: FormatAdapter;
  handle: unknown;
  paras: Paragraph[];
  /** The file started with a UTF-8 byte-order mark: typed text is re-read with it, so the save keeps it. */
  bom: boolean;
}

export const DOCX_NOTE = msg('doc.docxNote');
const UTF8_BOM = [0xef, 0xbb, 0xbf];
/** A line feed without a carriage return before it ("a\nb", but not "a\r\nb"). */
const BARE_LF = /(?:^|[^\r])\n/;

const startsWithBom = (bytes: Uint8Array) => UTF8_BOM.every((b, i) => bytes[i] === b);
const lineSeparatorOf = (text: string): '\n' | '\r\n' => (text.includes('\r\n') && !BARE_LF.test(text) ? '\r\n' : '\n');

/** Reads a file's bytes into the document view and what the check needs. Throws when the adapter can't read it. */
export async function readDocument(
  id: number,
  name: string,
  path: string | null,
  adapter: FormatAdapter,
  bytes: Uint8Array,
): Promise<{ loaded: LoadedFile; document: OpenDocument }> {
  const read = await adapter.read(bytes);
  const isDocx = name.toLowerCase().endsWith('.docx');
  const text = isDocx ? null : new TextDecoder().decode(bytes); // the decoder drops a byte-order mark
  const view = text === null ? joinParagraphs(read.paras) : { text, starts: paragraphStarts(text, read.paras) };
  return {
    loaded: { adapter, ...read, bom: startsWithBom(bytes) },
    document: {
      id,
      name,
      path,
      text: view.text,
      lineSeparator: text === null ? '\n' : lineSeparatorOf(text),
      editable: !isDocx,
      paraStarts: view.starts,
      note: isDocx ? DOCX_NOTE : null,
    },
  };
}

/** Re-reads text typed into an editable document (with its byte-order mark, if it had one). Throws as readDocument. */
export async function readTypedText(
  loaded: LoadedFile,
  document: OpenDocument,
  text: string,
): Promise<{ loaded: LoadedFile; document: OpenDocument }> {
  const { adapter, bom } = loaded;
  const encoded = new TextEncoder().encode(text);
  const read = await adapter.read(bom ? new Uint8Array([...UTF8_BOM, ...encoded]) : encoded);
  return {
    loaded: { adapter, ...read, bom },
    document: { ...document, text, paraStarts: paragraphStarts(text, read.paras) },
  };
}
