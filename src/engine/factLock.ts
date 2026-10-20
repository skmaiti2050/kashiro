import type { Candidate, Span } from './types';

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

const AUTHOR_YEAR = String.raw`\p{Lu}[\p{L}'’.-]*(?:\s+(?:et al\.|and|&|\p{Lu}[\p{L}'’.-]*))*,?\s*\d{4}[a-z]?(?:,\s*pp?\.\s*\d+(?:[–-]\d+)?)?`;

const URL_START = /^(?:https?:\/\/|www\.)/;

const PATTERNS: RegExp[] = [
  // code, math, LaTeX
  /`[^`\n]+`/g,
  /\$\$[\s\S]+?\$\$/g,
  /\$[^\s$](?:[^$\n]*[^\s$])?\$(?!\d)/g,
  /\\[A-Za-z]+\*?(?:\[[^\]\n]*\])*(?:\{[^{}\n]*\})*/g,
  // URLs and emails (trailing punctuation trimmed below)
  /(?:https?:\/\/|www\.)[^\s<>"”]+/g,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  // quotes
  /"[^"\n]+"/g,
  /“[^”\n]+”/g,
  // citations
  /\[\d+(?:\s*[,–-]\s*\d+)*\]/g,
  // (Author, 2020), (Author et al., 2020, p. 4), (A, 2010; B and C, 2014)
  new RegExp(
    String.raw`\(${AUTHOR_YEAR}(?:;\s*${AUTHOR_YEAR})*\)`,
    'gu',
  ),
  // dates
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}\.?(?:,?\s+\d{4})?\b`, 'g'),
  new RegExp(String.raw`\b${MONTH}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b`, 'g'),
  new RegExp(String.raw`\b${MONTH}\s+\d{4}\b`, 'g'),
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  // numbers: currency, statistics, versions, percentages
  /(?:Rs\.?\s?|[₹$€£¥])\s?\d[\d,]*(?:\.\d+)?/g,
  /\bp\s*[<>=≤≥]\s*\d*\.?\d+/gi,
  /\bv\d+(?:\.\d+)+\b/g,
  /\d[\d,]*(?:\.\d+)?%/g,
  // bare numbers: integers, decimals, 1,200 / 1,20,000, negatives, ordinals, ranges
  /(?<![\p{L}\p{N}])-?\d+(?:,\d+)*(?:\.\d+)?(?:st|nd|rd|th)?(?:\s*[–-]\s*\d+(?:,\d+)*(?:\.\d+)?(?:st|nd|rd|th)?)?(?![\p{L}\p{N}])/gu,
  // codes and identifiers mixing letters and digits, also hyphenated: 234B, 44ADA, B2B, q2, mp4, COVID-19
  /(?<![\p{L}\p{N}-])(?=[\p{L}\p{N}-]*\p{N})(?=[\p{L}\p{N}-]*\p{L})[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*(?![\p{L}\p{N}])/gu,
  // the word after a title is part of a name, whatever its case: "Mr. and Mrs.", "Dr. smith"
  /(?<=(?<![\p{L}])(?:Dr|Mr|Mrs|Ms|Prof|St|Mt)\.\s+)[\p{L}'’-]+/gu,
  // decades and ages: 60s, 1990s, ’90s, 1990's
  /(?<![\p{L}\p{N}])['’]?\d+['’]?s(?![\p{L}\p{N}])/gu,
  // ALL-CAPS acronyms, also plural (FPOs)
  /(?<![\p{L}\p{N}])\p{Lu}{2,}s?(?![\p{L}])/gu,
  // initials: A. / R. K. / R.K.
  /(?<![\p{L}\p{N}.])\p{Lu}\.(?:\s?\p{Lu}\.)*/gu,
];

/** A capitalised word, including names like D'Souza and O’Brien. */
const CAPITALISED = /(?<![\p{L}\p{N}'’])\p{Lu}(?:['’]\p{Lu})?\p{Ll}[\p{L}'’-]*/gu;
/** An opening quote or bracket, e.g. "(" in "(Joshi, 2020)". */
export const OPENERS = /["'(\[{“‘«]/;

/** Abbreviations whose period does not end a sentence (lowercased, without the final period). "No." is special-cased. */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'mt', 'jr', 'sr', 'e.g', 'i.e', 'etc', 'vs', 'fig', 'approx',
]);

/**
 * True when the '.' at `dot` closes an abbreviation, given the next word starts at `next`:
 * one of ABBREVIATIONS ("Dr.", not "hello."); "No." (case-sensitive) only before a digit ("No. 5");
 * a single capital initial ("K.") only before a capitalised word ("R. K. Narayan", not "Plan B. the"),
 * and not right after a digit or degree sign ("234C. The", "26 °C. My").
 */
function endsAbbreviation(text: string, dot: number, next: number): boolean {
  let k = dot;
  while (k > 0 && /[\p{L}.]/u.test(text[k - 1])) k--;
  const token = text.slice(k, dot);
  const after = text[next] ?? '';
  if (token === 'No') return /\d/.test(after);
  // A capital glued to a number or degree sign is a code or unit ("234C.", "26 °C."), not an initial.
  if (/^\p{Lu}$/u.test(token)) return !/[\p{N}°]/u.test(text[k - 1] ?? '') && /\p{Lu}/u.test(after);
  return ABBREVIATIONS.has(token.toLowerCase());
}

/** True when `text` before index `i` (ignoring spaces) ends with an abbreviation or initial, e.g. "Mr. |and". */
export function followsAbbreviation(text: string, i: number): boolean {
  let j = i;
  while (j > 0 && /\s/.test(text[j - 1])) j--;
  return j > 0 && text[j - 1] === '.' && endsAbbreviation(text, j - 1, i);
}

/** The start of a Markdown heading, list item or quote line, up to its first word ("## ", "- ", "1. ", "> "). */
const MARKDOWN_LINE_START = /^[ \t]*(?:#{1,6}|[-*+]|\d+[.)]|>)[ \t]+$/;

/** True when the word at `i` starts the paragraph or a sentence (not after an abbreviation such as "Mr."). */
export function isSentenceStart(text: string, i: number): boolean {
  if (i === 0) return true;
  if (OPENERS.test(text[i - 1])) return true;
  const line = text.slice(text.lastIndexOf('\n', i - 1) + 1, i);
  if (MARKDOWN_LINE_START.test(line)) return true;
  let j = i;
  while (j > 0 && /\s/.test(text[j - 1])) j--;
  if (j === i) return false; // glued to the previous word
  if (j === 0) return true;
  if (text[j - 1] === '.' && endsAbbreviation(text, j - 1, i)) return false;
  return '.?!:'.includes(text[j - 1]);
}

/** Ranges that must never be auto-changed. Sorted, merged. */
export function findLockedSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index!;
      let end = start + m[0].length;
      if (URL_START.test(m[0])) end = start + m[0].replace(/[.,;:!?)\]'’]+$/, '').length;
      spans.push({ start, end });
    }
  }
  for (const m of text.matchAll(CAPITALISED)) {
    if (!isSentenceStart(text, m.index!)) spans.push({ start: m.index!, end: m.index! + m[0].length });
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/** True when the candidate overlaps a locked span; an insertion point counts only strictly inside one. */
export function overlapsLocked(c: Candidate, locked: Span[] | undefined): boolean {
  if (!locked) return false;
  const { start, end } = c.span;
  return locked.some((s) =>
    start === end ? s.start < start && start < s.end : start < s.end && s.start < end,
  );
}
