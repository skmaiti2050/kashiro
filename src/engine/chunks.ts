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
 * `lint` over every paragraph, a chunk at a time with `pause` before each chunk. Each paragraph is linted on its
 * own, so the result is the same as one call over all of them. Without `pause` it is that one call. `pause` may
 * throw to stop the check (a newer one superseded it).
 */
export async function lintInChunks<T>(paras: Paragraph[], lint: (chunk: Paragraph[]) => Promise<T[]>, pause?: () => Promise<void>): Promise<T[]> {
  if (!pause) return lint(paras);
  const out: T[] = [];
  for (const chunk of chunksOf(paras)) {
    await pause();
    out.push(...(await lint(chunk)));
  }
  return out;
}
