/**
 * A word: letters or digits joined by ' . , or - ("it's", "1,20,000", "3.2", "well-known"). After its first
 * letter or digit it takes combining marks (Hindi and Bengali vowel signs, virama, nukta, anusvara) and the
 * zero-width joiner and non-joiner, so "हिंदी", "क्षत्रिय" and "র‍্যাব" are one word each.
 */
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}‌‍]*(?:['’.,-][\p{L}\p{N}][\p{L}\p{M}\p{N}‌‍]*)*/gu;

/** The words of `text`, in order. */
export function wordsOf(text: string): string[] {
  return text.match(WORD) ?? [];
}

/** Number of words in `text` (numbers like 1,20,000 and words like it's count once). */
export function countWords(text: string): number {
  return wordsOf(text).length;
}
