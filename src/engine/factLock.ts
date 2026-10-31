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
  // URLs and emails (trailing punctuation trimmed below). An email starts where its run of name characters does, so a
  // long token without "@" is read once, not once per character (Task F21d).
  /(?:https?:\/\/|www\.)[^\s<>"”]+/g,
  /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  // quotes
  /"[^"\n]+"/g,
  /“[^”\n]+”/g,
  // citations
  /\[\d+(?:\s*[,–-]\s*\d+)*\]/g,
  // Markdown link label or definition, label-sized: "[the the](url)", "[the the][ref]", "[the the]: url" (#7)
  /\[[^[\]\n]{1,40}\](?=[[(:])/g,
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
  // numbers: currency, statistics, versions, percentages. Amounts and bare numbers use \p{Nd}, so digits of
  // any script lock too: "₹५,०००", "৫০%" (\d is 0-9 only, even with the u flag).
  /(?:Rs\.?\s?|[₹$€£¥])\s?\p{Nd}[\p{Nd},]*(?:\.\p{Nd}+)?/gu,
  /\bp\s*[<>=≤≥]\s*\d*\.?\d+/gi,
  /\bv\d+(?:\.\d+)+\b/g,
  // a percentage starts at its first digit (not after a digit or "digit,"), so a long run of digits is read once
  /(?<!\p{Nd},?)\p{Nd}[\p{Nd},]*(?:\.\p{Nd}+)?%/gu,
  // bare numbers: integers, decimals, 1,200 / 1,20,000, negatives, ordinals, ranges
  /(?<![\p{L}\p{N}])-?\p{Nd}+(?:,\p{Nd}+)*(?:\.\p{Nd}+)?(?:st|nd|rd|th)?(?:\s*[–-]\s*\p{Nd}+(?:,\p{Nd}+)*(?:\.\p{Nd}+)?(?:st|nd|rd|th)?)?(?![\p{L}\p{N}])/gu,
  // camelCase and inner capitals, 4+ characters: preventDefault, iPhone, DevTools (not "tHe"; lookaheads from a word start: linear)
  /(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]*\p{Ll}\p{Lu})(?=[\p{L}\p{N}]{4})[\p{L}\p{N}]+/gu,
  // the word after a title is part of a name, whatever its case: "Mr. and Mrs.", "Dr. smith"
  /(?<=(?<![\p{L}])(?:Dr|Mr|Mrs|Ms|Prof|St|Mt)\.\s+)[\p{L}'’-]+/gu,
  // decades and ages: 60s, 1990s, ’90s, 1990's
  /(?<![\p{L}\p{N}])['’]?\d+['’]?s(?![\p{L}\p{N}])/gu,
  // ALL-CAPS acronyms, also plural (FPOs)
  /(?<![\p{L}\p{N}])\p{Lu}{2,}s?(?![\p{L}])/gu,
  // initials: A. / R. K. / R.K.
  /(?<![\p{L}\p{N}.])\p{Lu}\.(?:\s?\p{Lu}\.)*/gu,
];

/**
 * A word-like token, with an optional path or handle start and parts joined by "." "/" "\" or "@":
 * "et.reportAllChanges", "./build", "C:\work", "@sujit", "q2", "home.then". The filters below decide
 * which are code; most matches are plain words and are dropped.
 */
const TOKEN = /(?<![\p{L}\p{N}_$./\\@~:-])(?:~\/|\.{1,2}\/|\/|@|\p{L}:\\)?[\p{L}\p{N}_$-]+(?:[./\\@][\p{L}\p{N}_$-]+)*/gu;
/** File extensions that make "name.ext" a file name: "report.docx". */
const FILE_EXTENSION = /\.(?:docx|pdf|js|ts|json|md|txt|py|html|css|png|jpg|csv)$/i;
/** A path start: "/usr", "./build", "../lib", "~/notes", "C:\work". */
const PATH_START = /^(?:\/|\.{1,2}\/|~\/|\p{L}:\\)/u;
/** An email address: "a@b.co". */
const EMAIL = /^[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}$/u;
/** A handle: "@sujit". */
const HANDLE = /^@[\p{L}\p{N}_]+$/u;
/** A "/" or "\" path ending in a file name: "src/ui/app.tsx", "docs\notes.md" (not "recieve/send/get"). */
const PATH_TO_FILE = /[/\\][\p{L}\p{N}_$-]+\.[\p{L}\p{N}]+$/u;
const INNER_CAPITAL = /\p{Ll}\p{Lu}/u;
/** One hyphen-separated part of an identifier: "q2", "mp4", "4K", "B2B", "COVID", "19" (not "y0u", "th9s"). */
const IDENTIFIER_PART = /^(?:\p{L}+\p{N}+|\p{N}+\p{L}+|[\p{Lu}\p{N}]+|\p{L}+|\p{N}+)$/u;
/** A lowercase word with a footnote number or year: "recieve1", "recieve-2020", "budget-21". */
const WORD_WITH_NUMBER = /^\p{Ll}{4,}(?:\p{N}{1,3}|-\p{N}{2}|-\p{N}{4})$/u;
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\p{N}/u;
/** Hyphens at the end of a token ("well-" in "well- and ill-"), not part of it. */
const TRAILING_JOINERS = /-+$/u;

/** An identifier mixing letters and digits ("q2", "mp4", "B2B", "COVID-19"); not a word with a footnote ("recieve1"). */
export function isLettersAndDigitsIdentifier(token: string): boolean {
  if (!HAS_LETTER.test(token) || !HAS_DIGIT.test(token) || WORD_WITH_NUMBER.test(token)) return false;
  return token.split('-').every((part) => IDENTIFIER_PART.test(part));
}

/** A part only code has: an underscore, an inner capital (4+ characters) or letters mixed with digits ("v2"). */
function isCodePart(part: string): boolean {
  if (part.includes('_')) return true;
  if (part.length >= 4 && INNER_CAPITAL.test(part)) return true;
  return HAS_LETTER.test(part) && HAS_DIGIT.test(part);
}

/**
 * True for a joined token that is code, not prose:
 * - "@": an email ("a@b.co") or a handle ("@sujit"), not "sujit@home";
 * - a path start ("/usr", "./build", "~/x", "C:\work"), "www.", or a path to a file ("src/ui/app.tsx");
 * - a known file extension ("report.docx");
 * - a part with an underscore, inner capital or letters+digits ("et.reportAllChanges", "v2.beta").
 * Plain words joined by "." "/" or "\" ("home.then", "recieve/send/get", "2020.the") are prose: a missing
 * space, a pair or a list of choices, however many separators.
 */
export function isCodePath(token: string): boolean {
  if (token.includes('@')) return EMAIL.test(token) || HANDLE.test(token);
  if (PATH_START.test(token) || token.toLowerCase().startsWith('www.')) return true;
  if (PATH_TO_FILE.test(token)) return true;
  const parts = token.split(/[./\\]/);
  if (parts.length < 2) return false;
  return FILE_EXTENSION.test(token) || parts.some(isCodePart);
}

/** A capitalised word, including names like D'Souza and O’Brien. */
const CAPITALISED = /(?<![\p{L}\p{N}'’])\p{Lu}(?:['’]\p{Lu})?\p{Ll}[\p{L}'’-]*/gu;
/** An opening quote or bracket, e.g. "(" in "(Joshi, 2020)". */
export const OPENERS = /["'(\[{“‘«]/;

/**
 * Abbreviations whose period does not end a sentence (lowercased, without the final period), common Indian
 * forms included ("Govt. of India", "Pvt. Ltd.", "500 sq. ft.": F3 re-review 2, C-4). "No." is special-cased.
 */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'mt', 'jr', 'sr', 'e.g', 'i.e', 'etc', 'vs', 'fig', 'approx',
  'govt', 'pvt', 'ltd', 'inc', 'co', 'corp', 'dept', 'rd', 'viz', 'cf', 'sq', 'ft', 'hr', 'hrs', 'min', 'mins',
  'nos', 'rs', 'al', 'vol', 'ch', 'pp', 'est', 'misc', 'a.m', 'p.m',
]);

/** Invisible and format characters: a mark typed before an abbreviation's full stop ("etc<U+200E>."). */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
/** A character of an abbreviation as written: a letter, its dots, or an invisible mark among them. */
const ABBREVIATION_CHAR = /[\p{L}.\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/**
 * True when the '.' at `dot` closes an abbreviation, given the next word starts at `next`:
 * one of ABBREVIATIONS ("Dr.", not "hello."); "No." (case-sensitive) only before a digit ("No. 5");
 * a single capital initial ("K.") only before a capitalised word ("R. K. Narayan", not "Plan B. the"),
 * and not right after a digit or degree sign ("234C. The", "26 °C. My"). Invisible characters in the
 * abbreviation are read through (F3 re-review 2, I-1).
 */
function endsAbbreviation(text: string, dot: number, next: number): boolean {
  let k = dot;
  while (k > 0 && ABBREVIATION_CHAR.test(text[k - 1])) k--;
  const token = text.slice(k, dot).replace(INVISIBLE, '');
  const after = text[next] ?? '';
  if (token === 'No') return /\d/.test(after);
  // A capital glued to a number or degree sign is a code or unit ("234C.", "26 °C."), not an initial.
  if (/^\p{Lu}$/u.test(token)) return !/[\p{N}°]/u.test(text[k - 1] ?? '') && /\p{Lu}/u.test(after);
  return ABBREVIATIONS.has(token.toLowerCase());
}

/** Whitespace or an invisible character between an abbreviation's full stop and the next word. */
const GAP = /[\s\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
/** The word "no" (lowercase) right before a full stop: "the no." */
const LOWERCASE_NO = /(?<![\p{L}.])no$/u;

/**
 * True when `text` before index `i` (ignoring spaces) ends with an abbreviation or initial, e.g. "Mr. |and".
 * A lowercase "no." counts too: it may be "number" ("the no. of students"), so a capital after it is asked,
 * though it can also end a sentence ("I said no. the end") and isSentenceStart still reads it so.
 */
export function followsAbbreviation(text: string, i: number): boolean {
  let j = i;
  while (j > 0 && GAP.test(text[j - 1])) j--;
  if (j === 0 || text[j - 1] !== '.') return false;
  // A few characters before the dot are enough to see "no", and keep this cheap on a long paragraph.
  return endsAbbreviation(text, j - 1, i) || LOWERCASE_NO.test(text.slice(Math.max(0, j - 9), j - 1).replace(INVISIBLE, ''));
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
  return '.?!:।॥'.includes(text[j - 1]);
}

/** A Markdown reference definition at a line start: "[the the]: https://example.com" (group 1 is the label). */
const LINK_DEFINITION = /^[ \t]{0,3}\[([^[\]\n]{1,40})\]:/gm;
/** A label-sized bracket pair with no nested brackets: "[the the]". */
const BRACKET_LABEL = /\[([^[\]\n]{1,40})\]/g;

/** The labels (lowercased) that `texts` define: the definition and its paragraph can differ, so pass the whole document. */
export function definedLinkLabels(texts: Iterable<string>): Set<string> {
  const labels = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(LINK_DEFINITION)) labels.add(m[1].toLowerCase());
  return labels;
}

/** Defined labels used shortcut-style ("See [the the] for details."): link text, not prose. */
function definedLabelSpans(text: string, labels: ReadonlySet<string>): Span[] {
  if (labels.size === 0) return [];
  return [...text.matchAll(BRACKET_LABEL)]
    .filter((m) => labels.has(m[1].toLowerCase()))
    .map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
}

/**
 * Ranges that must never be auto-changed. Sorted, merged. `linkLabels` are the reference-link labels the whole
 * document defines (definedLinkLabels); by default only this text's own count.
 */
export function findLockedSpans(text: string, linkLabels: ReadonlySet<string> = definedLinkLabels([text])): Span[] {
  const spans: Span[] = definedLabelSpans(text, linkLabels);
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index!;
      let end = start + m[0].length;
      if (URL_START.test(m[0])) end = start + m[0].replace(/[.,;:!?)\]'’]+$/, '').length;
      spans.push({ start, end });
    }
  }
  for (const m of text.matchAll(TOKEN)) {
    const token = m[0].replace(TRAILING_JOINERS, '');
    if (isCodePath(token) || isLettersAndDigitsIdentifier(token)) spans.push({ start: m.index!, end: m.index! + token.length });
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
