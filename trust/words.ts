import type { Paragraph } from '../src/engine/types';
import { countWords as countTextWords } from '../src/engine/words';

/** Words in the paragraphs the app sees (numbers like 1,20,000 and words like it's count once). */
export function countWords(paras: Paragraph[]): number {
  return paras.reduce((n, p) => n + countTextWords(p.text), 0);
}
