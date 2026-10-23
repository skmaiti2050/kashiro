/** Why a file can't be opened, for a plain message that says what to do (spec §3: never crash, never write). */
export type FileProblem = 'damaged' | 'notWord' | 'encrypted' | 'oldWord' | 'notUtf8' | 'utf16' | 'binary' | 'empty' | 'tooLong';

/** Thrown by an adapter's read (or the open path) for a file it can't open. The message is English, for the CLI. */
export class UnreadableFileError extends Error {
  constructor(
    readonly problem: FileProblem,
    message: string,
    /** Numbers the message shows ("tooLong": words and limit). */
    readonly values: Record<string, number> = {},
  ) {
    super(message);
    this.name = 'UnreadableFileError';
  }
}

/** An OLE compound file: an old Word .doc, or a password-protected Office file (which Word wraps in one). */
const COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** "PK": every zip package, so every .docx, starts with it. */
export const ZIP_MAGIC = [0x50, 0x4b];
/** The stream Office stores a password-protected document in. */
const ENCRYPTED_STREAM = 'EncryptedPackage';
/** How much of a text file the binary and UTF-16 sniffing looks at. */
const SNIFF_BYTES = 8192;
/** Control bytes that never occur in text (tab, line feed, form feed and carriage return are allowed). */
const isControlByte = (b: number) => b < 0x09 || (b > 0x0d && b < 0x20) || b === 0x7f;

export const startsWith = (bytes: Uint8Array, magic: number[]): boolean => magic.every((b, i) => bytes[i] === b);

/** True when `word` appears in `bytes` as UTF-16LE (how compound files name their streams). */
function containsUtf16Le(bytes: Uint8Array, word: string): boolean {
  const first = word.charCodeAt(0);
  outer: for (let i = 0; i + word.length * 2 <= bytes.length; i++) {
    if (bytes[i] !== first || bytes[i + 1] !== 0) continue;
    for (let j = 1; j < word.length; j++) {
      if (bytes[i + 2 * j] !== word.charCodeAt(j) || bytes[i + 2 * j + 1] !== 0) continue outer;
    }
    return true;
  }
  return false;
}

/** For a .docx that isn't a zip package: an old .doc, or a Word file protected with a password. Null otherwise. */
export function compoundFileProblem(bytes: Uint8Array): UnreadableFileError | null {
  if (!startsWith(bytes, COMPOUND_FILE_MAGIC)) return null;
  if (containsUtf16Le(bytes, ENCRYPTED_STREAM)) return new UnreadableFileError('encrypted', 'the Word document is protected with a password');
  return new UnreadableFileError('oldWord', 'an old Word 97-2003 document (.doc), not a .docx');
}

/** Share of the bytes at even (`parity` 0) or odd (1) positions that are zero. */
function zeroShare(sample: Uint8Array, parity: 0 | 1): number {
  let zeros = 0;
  let count = 0;
  for (let i = parity; i < sample.length; i += 2, count++) if (sample[i] === 0) zeros++;
  return count ? zeros / count : 0;
}

/**
 * Why bytes meant as text are not UTF-8 text, judged before decoding: UTF-16 (a byte-order mark, or a zero
 * byte beside almost every letter) or binary data (zero or other control bytes). Null when they may be text.
 */
export function textProblem(bytes: Uint8Array): UnreadableFileError | null {
  const utf16 = new UnreadableFileError('utf16', 'not UTF-8 text: the file is saved as UTF-16');
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return utf16;
  const sample = bytes.subarray(0, SNIFF_BYTES);
  const [even, odd] = [zeroShare(sample, 0), zeroShare(sample, 1)];
  if (sample.length >= 4 && Math.max(even, odd) > 0.7 && Math.min(even, odd) < 0.1) return utf16;
  const controls = sample.filter(isControlByte).length;
  if (controls > 0 && (sample.includes(0) || controls / sample.length > 0.05)) {
    return new UnreadableFileError('binary', 'not a text file: it holds binary data');
  }
  return null;
}
