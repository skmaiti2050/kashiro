import type { Paragraph } from '../src/engine/types';

const WORD = /[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu;

/** Words in the paragraphs the app sees (numbers like 1,20,000 and words like it's count once). */
export function countWords(paras: Paragraph[]): number {
  return paras.reduce((n, p) => n + (p.text.match(WORD)?.length ?? 0), 0);
}
