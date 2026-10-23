import type { Candidate } from './types';

/**
 * A list label at the start of a line, followed by a space: a letter, a roman numeral (i–xxxix) or a number,
 * then "." or ")", or the same in brackets. Example matches: "a." in "a. is public", "(iv)", "b)", "12.".
 */
const LIST_LABEL = /^[ \t]*(?:\((?:[a-z]|[ivx]{1,6}|\d{1,3})\)|(?:[a-z]|[ivx]{1,6}|\d{1,3})[.)])(?=[ \t])/i;

/** Two or more capitals, optionally a plural "s": "SOPs", "UPI", "KPIs" (not "THe"). */
const ACRONYM = /^\p{Lu}{2,}s?$/u;

const ONLY_SPACE = /^\s*$/;

/**
 * A rules flag a list label causes (spec §5 never-damage): a respelling or capital of the label itself
 * ("a." → "A."), or a capital for the word after it ("a. is" → "a. Is"), which continues the sentence
 * that introduced the list. In a list item the format numbers itself (`listItem`, a Word w:numPr paragraph),
 * the first word is such a continuation too.
 */
export function isListLabelFlag(c: Candidate, text: string, listItem: boolean): boolean {
  if (c.source !== 'rules') return false;
  const lineStart = text.lastIndexOf('\n', c.span.start - 1) + 1;
  const before = text.slice(lineStart, c.span.start);
  if (listItem && lineStart === 0 && c.kind === 'Capitalization' && ONLY_SPACE.test(before)) return true;
  const label = LIST_LABEL.exec(text.slice(lineStart));
  if (!label) return false;
  const labelEnd = lineStart + label[0].length;
  if (c.span.start < labelEnd) return true;
  return c.kind === 'Capitalization' && ONLY_SPACE.test(text.slice(labelEnd, c.span.start));
}

/** A flag whose only suggestions lowercase an acronym ("SOPs" → "sops"): acronyms are identifiers, never respelled. */
export function lowersAcronym(c: Candidate): boolean {
  if (!ACRONYM.test(c.original) || c.replacements.length === 0) return false;
  return c.replacements.every((r) => r !== c.original && r.toLowerCase() === c.original.toLowerCase());
}
