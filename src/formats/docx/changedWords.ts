/**
 * The part of an edit that really changes, in whole words, so a tracked change shows "needs → needs to" as an
 * insertion of " to" instead of a deleted and re-inserted "needs" (Task F30).
 */

/**
 * A token: a word (anything but whitespace, punctuation and symbols, with inner apostrophes: "don't"; invisible
 * joiners stay inside it), a run of whitespace ("  "), or one punctuation mark or symbol ("."). Every character
 * belongs to exactly one token, so the tokens join back to the text.
 */
const TOKEN = /[^\s\p{P}\p{S}]+(?:['’][^\s\p{P}\p{S}]+)*|\s+|[\p{P}\p{S}]/gu;

/** The changed middle of an edit: [start, end) in the original text, and the text that replaces it. */
export interface ChangedWords {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Drop the whole tokens `original` and `replacement` share at the start, then at the end. The start is trimmed
 * first, so "the the" → "the" keeps the first "the" and changes " the". A word is never cut: "recieve" →
 * "receive" changes the whole word, and a whitespace run is one token, so "  " → " " changes the whole run.
 */
export function changedWords(original: string, replacement: string): ChangedWords {
  const before = original.match(TOKEN) ?? [];
  const after = replacement.match(TOKEN) ?? [];
  // Defensive: if the tokens ever failed to cover the text, change the whole span rather than guess.
  if (before.join('') !== original || after.join('') !== replacement) return { start: 0, end: original.length, replacement };
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (head + tail < before.length && head + tail < after.length && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return {
    start: before.slice(0, head).join('').length,
    end: original.length - before.slice(before.length - tail).join('').length,
    replacement: after.slice(head, after.length - tail).join(''),
  };
}
