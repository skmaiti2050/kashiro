/** A word: letters or digits joined by ' . , or - ("it's", "1,20,000", "3.2", "well-known"). */
const WORD = /[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu;

/** The words of `text`, in order. */
export function wordsOf(text: string): string[] {
  return text.match(WORD) ?? [];
}

/** Number of words in `text` (numbers like 1,20,000 and words like it's count once). */
export function countWords(text: string): number {
  return wordsOf(text).length;
}
