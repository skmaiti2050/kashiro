import { CODE_AND_MATH_PATTERNS, URL_AND_EMAIL_PATTERNS } from './factLock';
import { countWords } from './otherLanguage';
import type { Paragraph, Span } from './types';

/** A letter of the script the checker reads (English): "a", "é". */
const LATIN_LETTER = /\p{Script=Latin}/gu;

/** The script English is written in, and so the default one checked. */
const DEFAULT_SCRIPT = 'Latin';

/** A letter or sign of the Unicode script `script` ('Devanagari': "क", "ि"); a name Unicode doesn't know is an error. */
function buildScriptLetter(script: string, flags: string): RegExp {
  try {
    return new RegExp(`(?=[\\p{L}\\p{M}])\\p{Script=${script}}`, flags);
  } catch {
    throw new Error(`"${script}" is not a Unicode script name: use one such as "Devanagari" or "Bengali".`);
  }
}

// Built once per script: these run on every paragraph, and the rules pass must stay fast.
const scriptLetters = new Map<string, RegExp>();
const anyScriptLetters = new Map<string, RegExp>();

/** The global pattern for the letters of `script`, for counting. */
function scriptLetter(script: string): RegExp {
  let re = scriptLetters.get(script);
  if (!re) scriptLetters.set(script, (re = buildScriptLetter(script, 'gu')));
  return re;
}

/** The same, without `g`, so `.test` short-circuits and keeps no state. */
function anyScriptLetter(script: string): RegExp {
  let re = anyScriptLetters.get(script);
  if (!re) anyScriptLetters.set(script, (re = buildScriptLetter(script, 'u')));
  return re;
}

interface OtherScriptPatterns {
  /** A letter or sign of any script but `ownScript`, which the checker can't check: Hindi "क" in English text. */
  letter: RegExp;
  /** A run of such words (#29): "नमस्ते", or "रामायण और महाभारत" as one. */
  run: RegExp;
}

const otherScriptPatterns = new Map<string, OtherScriptPatterns>();

/**
 * The other-script patterns for a document proofread in `ownScript`. Accents (Inherited), digits, punctuation and
 * emoji (Common) are no language. A word is a letter outside `ownScript`, then letters, marks and joiners; words are
 * joined only by spaces/punctuation (never own-script letters or digits), so "She said नमस्ते, ok" ends at "ते".
 * Each separator needs 1+ characters, so the pattern cannot backtrack badly.
 */
function otherScriptOf(ownScript: string): OtherScriptPatterns {
  const known = otherScriptPatterns.get(ownScript);
  if (known) return known;
  scriptLetter(ownScript); // an unknown script name throws here, with its actionable message
  const letter = `(?![\\p{Script=${ownScript}}\\p{Script=Inherited}\\p{Script=Common}])[\\p{L}\\p{M}]`;
  // A joiner (ZWJ/ZWNJ) only inside a word, never alone: a stray one in the text is not a passage.
  const word = `${letter}(?:${letter}|[\\u200c\\u200d])*`;
  const patterns = {
    letter: new RegExp(letter, 'gu'),
    run: new RegExp(`${word}(?:[\\s\\p{P}]+${word})*`, 'gu'),
  };
  otherScriptPatterns.set(ownScript, patterns);
  return patterns;
}

/** A passage of a checked paragraph that Kashiro did not really check (#29). */
export interface UncheckedPassage {
  paraId: number;
  span: Span;
  /** A run of words in another script, or a sentence the classifier found to be another Latin-script language. */
  kind: 'otherScript' | 'otherLanguage';
}

/** A run that is one Greek or Cyrillic letter (with marks): "α", "Δ", "Ж" are notation in maths, not language. */
const SINGLE_NOTATION_LETTER = /^[\p{Script=Greek}\p{Script=Cyrillic}]\p{M}*$/u;

/**
 * The runs of words in `text` outside `ownScript` (the proofread script), in order, end-exclusive. Letters with accents
 * (José, Müller), digits, punctuation, emoji and a lone Greek or Cyrillic letter are never passages.
 */
export function otherScriptPassages(text: string, ownScript = DEFAULT_SCRIPT): Span[] {
  return [...text.matchAll(otherScriptOf(ownScript).run)]
    .filter((m) => !SINGLE_NOTATION_LETTER.test(m[0]))
    .map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/** A ``` or ~~~ code block to its closing fence (or the end of the text): "```\nx = 1\n```". */
const FENCED_CODE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|$)|(?![\s\S]))/gm;
/** LaTeX's own brackets, which factLock does not lock: "\(x\)", "\[x\]". */
const LATEX_BRACKETS = /\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;

/** An HTML or XML tag, opening, closing or empty: "<br>", "</b>", "<a href=\"x\">", "<br/>". */
const HTML_TAG = /<\/?[A-Za-z][\w:-]*(?:\s[^<>\n]*)?\/?>/g;

/**
 * What in `text` is not language: code and math (factLock's code/math locks plus fenced blocks and \(..\) \[..\]),
 * URLs, email addresses and HTML tags. In English those are Latin text and never passages anyway; with another
 * proofread script they would be. Quoted text is locked too but is deliberately not here: a Hindi quote in English
 * is what #29 marks.
 */
function notLanguageSpans(text: string): Span[] {
  return [...CODE_AND_MATH_PATTERNS, FENCED_CODE, LATEX_BRACKETS, ...URL_AND_EMAIL_PATTERNS, HTML_TAG].flatMap((re) =>
    [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length })),
  );
}

/** True when `text` has a letter of the Unicode script `script` ("Latin", "Devanagari"). */
export function hasLetterOf(text: string, script: string): boolean {
  return anyScriptLetter(script).test(text);
}

/** True when `text` has any Latin letter: some English (or at least Latin-script) text was there to check. */
export function hasLatinLetter(text: string): boolean {
  return hasLetterOf(text, DEFAULT_SCRIPT);
}

/** The other-script runs left in `run` once `cuts` (sorted by start, may overlap) are cut out, trimmed of separators. */
function outsideCuts(text: string, run: Span, cuts: readonly Span[], ownScript: string): Span[] {
  const pieces: Span[] = [];
  let from = run.start;
  for (const s of cuts) {
    if (s.end <= from || s.start >= run.end) continue;
    if (s.start > from) pieces.push({ start: from, end: s.start });
    from = Math.max(from, s.end);
  }
  if (from < run.end) pieces.push({ start: from, end: run.end });
  return pieces.flatMap((piece) =>
    otherScriptPassages(text.slice(piece.start, piece.end), ownScript).map((r) => ({ start: piece.start + r.start, end: piece.start + r.end })),
  );
}

/**
 * A foreign sentence shorter than this is not reported: a heading ("Reportees") or a name ("Priyanshu Dubey") alone is
 * too little text to call a language. Only the report changes; such words stay protected from zero-click fixes.
 */
export const MIN_REPORTED_FOREIGN_WORDS = 3;

/**
 * The passages the check did not read inside the paragraphs it did check: other-script runs plus the foreign
 * sentences setup already found, in document order. Set-aside paragraphs (#2a) are skipped, a block marker covers them.
 * `ownScript` is the proofread script ('Latin' for English). Only English finds foreign sentences, so for any other
 * script the caller passes an empty map.
 */
export function uncheckedPassages(
  paras: readonly Paragraph[],
  setAside: ReadonlySet<number>,
  foreignSentences: ReadonlyMap<number, Span[]>,
  ownScript = DEFAULT_SCRIPT,
): UncheckedPassage[] {
  return paras
    .filter((p) => !setAside.has(p.id))
    .flatMap((p) => {
      const sentences = (foreignSentences.get(p.id) ?? []).filter(
        (s) => countWords(p.text.slice(s.start, s.end)) >= MIN_REPORTED_FOREIGN_WORDS,
      );
      // A foreign sentence covers the runs inside it; what a run has outside it is still reported, so passages never overlap.
      // Code, math, URLs, emails and tags are cut out too: they are not language.
      const cuts = [...sentences, ...notLanguageSpans(p.text)].sort((a, b) => a.start - b.start);
      const runs = otherScriptPassages(p.text, ownScript).flatMap((r) => outsideCuts(p.text, r, cuts, ownScript));
      return [
        ...runs.map((span) => ({ paraId: p.id, span, kind: 'otherScript' as const })),
        ...sentences.map((span) => ({ paraId: p.id, span, kind: 'otherLanguage' as const })),
      ].sort((a, b) => a.span.start - b.span.start);
    });
}

const count = (text: string, letters: RegExp) => text.match(letters)?.length ?? 0;

/** The ids of the paragraphs whose letters are mostly not Latin: the check sets them aside (#2a), in document order. */
export function otherScriptParagraphIds(paras: readonly Paragraph[]): number[] {
  return paras.filter((p) => count(p.text, otherScriptOf(DEFAULT_SCRIPT).letter) > count(p.text, LATIN_LETTER)).map((p) => p.id);
}

/**
 * Which of `scripts` (Unicode script names) `text` is written in: the one with the most other-script letters, more
 * than every other script in `scripts` and more than all letters of unlisted scripts together. Undefined on a tie or
 * when unlisted scripts outweigh it, so a mixed paragraph never goes to an engine for a script it is mostly not in.
 */
export function dominantScript(text: string, scripts: Iterable<string>): string | undefined {
  const letters = count(text, otherScriptOf(DEFAULT_SCRIPT).letter);
  let best: string | undefined;
  let bestCount = 0;
  let listed = 0;
  for (const script of scripts) {
    const n = count(text, scriptLetter(script));
    listed += n;
    if (n > bestCount) [best, bestCount] = [script, n];
    else if (n === bestCount) best = undefined;
  }
  return bestCount > letters - listed ? best : undefined;
}

/**
 * Which of `scripts` (Unicode script names) a document of `texts` is mostly written in: the one with more letters
 * than Latin and than each other script in `scripts`. Undefined on any tie: the document is then English's.
 * Letters of unlisted scripts do not count.
 */
export function majorityScript(texts: readonly string[], scripts: Iterable<string>): string | undefined {
  const text = texts.join('\n');
  let best: string | undefined;
  let bestCount = count(text, LATIN_LETTER);
  for (const script of scripts) {
    const n = count(text, scriptLetter(script));
    if (n > bestCount) [best, bestCount] = [script, n];
    else if (n === bestCount) best = undefined;
  }
  return best;
}

/** Any letter of any script: "a", "क". */
const ANY_LETTER = /\p{L}/gu;

/** True when the set-aside paragraphs hold more letters than the rest: most of the document was not checked. */
export function mostlyNotChecked(paras: readonly Paragraph[], setAside: ReadonlySet<number>): boolean {
  let aside = 0;
  let checked = 0;
  for (const p of paras) {
    if (setAside.has(p.id)) aside += count(p.text, ANY_LETTER);
    else checked += count(p.text, ANY_LETTER);
  }
  return aside > checked;
}
