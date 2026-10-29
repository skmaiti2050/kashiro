import type { Paragraph } from './types';

/**
 * Characters of text linted between two pauses: about 50 ms of linting on a typical PC, so the UI can answer a
 * click, a scroll or a key between chunks of a long check (Task F20 item 6).
 */
export const CHUNK_CHARACTERS = 1500;

/** The paragraphs in order, cut into chunks of at most CHUNK_CHARACTERS; a longer paragraph is a chunk alone. */
export function chunksOf(paras: readonly Paragraph[]): Paragraph[][] {
  const chunks: Paragraph[][] = [];
  let chunk: Paragraph[] = [];
  let size = 0;
  for (const p of paras) {
    if (chunk.length > 0 && size + p.text.length > CHUNK_CHARACTERS) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(p);
    size += p.text.length;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

/**
 * `lint` over `paras`; when it throws, each paragraph again on its own, and one that still throws is passed to
 * `unchecked` and left out, so the rest is still checked (Task F21d, review I-4: Harper panicked on a long hex
 * token). A panic leaves Harper's WASM unusable for the rest of the process, so every later paragraph is then
 * reported too: never a false all-clear.
 */
async function lintOrReport<T>(paras: Paragraph[], lint: (chunk: Paragraph[]) => Promise<T[]>, unchecked: (p: Paragraph, error: unknown) => void): Promise<T[]> {
  try {
    return await lint(paras);
  } catch (error) {
    if (paras.length === 1) {
      unchecked(paras[0], error);
      return [];
    }
    const out: T[] = [];
    for (const p of paras) out.push(...(await lintOrReport([p], lint, unchecked)));
    return out;
  }
}

/**
 * `lint` over every paragraph, a chunk at a time with `pause` before each chunk. Each paragraph is linted on its
 * own, so the result is the same as one call over all of them. Without `pause` it is that one call. `pause` may
 * throw to stop the check (a newer one superseded it). A paragraph `lint` throws on goes to `unchecked`; when it
 * throws on every paragraph, nothing was checked and its first error is thrown: the check failed.
 */
export async function lintInChunks<T>(
  paras: Paragraph[],
  lint: (chunk: Paragraph[]) => Promise<T[]>,
  unchecked: (p: Paragraph) => void,
  pause?: () => Promise<void>,
): Promise<T[]> {
  const failed: { p: Paragraph; error: unknown }[] = [];
  const report = (p: Paragraph, error: unknown) => failed.push({ p, error });
  const out: T[] = [];
  for (const chunk of pause ? chunksOf(paras) : [paras]) {
    if (pause) await pause();
    out.push(...(await lintOrReport(chunk, lint, report)));
  }
  if (failed.length > 0 && failed.length === paras.length) throw failed[0].error;
  for (const { p } of failed) unchecked(p);
  return out;
}
