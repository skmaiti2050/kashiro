import type { Span } from './types';

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

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
  /\(\p{Lu}[\p{L}'’.-]*(?:\s+(?:et al\.|and|&|\p{Lu}[\p{L}'’.-]*))*,?\s*\d{4}[a-z]?(?:,\s*pp?\.\s*\d+(?:[–-]\d+)?)?\)/gu,
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
  // ALL-CAPS acronyms
  /(?<![\p{L}\p{N}])\p{Lu}{2,}(?![\p{L}])/gu,
];

const CAPITALISED = /(?<![\p{L}\p{N}'’])\p{Lu}\p{Ll}[\p{L}'’-]*/gu;
const OPENERS = /["'(\[{“‘«]/;

function isSentenceStart(text: string, i: number): boolean {
  if (i === 0) return true;
  if (OPENERS.test(text[i - 1])) return true;
  let j = i;
  while (j > 0 && /\s/.test(text[j - 1])) j--;
  if (j === i) return false; // glued to the previous word
  return j === 0 || '.?!:'.includes(text[j - 1]);
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
