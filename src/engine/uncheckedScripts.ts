import type { Paragraph, Span } from './types';

/** A letter of the script the checker reads (English): "a", "é". */
const LATIN_LETTER = /\p{Script=Latin}/gu;
/** The same, without `g`, so `.test` short-circuits and keeps no state. */
const ANY_LATIN_LETTER = /\p{Script=Latin}/u;
/**
 * A letter or sign of any other script, which the checker can't check yet: Hindi "क", Bengali "ো", Tamil "த",
 * Urdu "ب", Russian "д". Accents (Inherited), digits, punctuation and emoji (Common) are no language.
 */
const OTHER_SCRIPT_LETTER = /(?![\p{Script=Latin}\p{Script=Inherited}\p{Script=Common}])[\p{L}\p{M}]/gu;

/**
 * A run of other-script words (#29): "नमस्ते", or "रामायण और महाभारत" as one. A word is a letter that is not Latin, then
 * letters, marks and joiners; words are joined only by spaces/punctuation (never Latin letters or digits), so
 * "She said नमस्ते, ok" ends at "ते". Each separator needs 1+ characters, so the pattern cannot backtrack badly.
 */
// A joiner (ZWJ/ZWNJ) only inside a word, never alone: a stray one in English text is not a passage.
const OTHER_SCRIPT_WORD = `${OTHER_SCRIPT_LETTER.source}(?:${OTHER_SCRIPT_LETTER.source}|[\\u200c\\u200d])*`;
const OTHER_SCRIPT_RUN = new RegExp(`${OTHER_SCRIPT_WORD}(?:[\\s\\p{P}]+${OTHER_SCRIPT_WORD})*`, 'gu');

/** A passage of a checked paragraph that Kashiro did not really check (#29). */
export interface UncheckedPassage {
  paraId: number;
  span: Span;
  /** A run of words in another script, or a sentence the classifier found to be another Latin-script language. */
  kind: 'otherScript' | 'otherLanguage';
}

/**
 * The runs of other-script words in `text`, in order, end-exclusive. Latin letters with accents (José, Müller),
 * digits, punctuation and emoji are never passages.
 */
export function otherScriptPassages(text: string): Span[] {
  return [...text.matchAll(OTHER_SCRIPT_RUN)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/** True when `text` has any Latin letter: some English (or at least Latin-script) text was there to check. */
export function hasLatinLetter(text: string): boolean {
  return ANY_LATIN_LETTER.test(text);
}

/** The other-script runs left in `run` once `sentences` (sorted, apart) are cut out, trimmed of separators. */
function outsideSentences(text: string, run: Span, sentences: readonly Span[]): Span[] {
  const pieces: Span[] = [];
  let from = run.start;
  for (const s of sentences) {
    if (s.end <= from || s.start >= run.end) continue;
    if (s.start > from) pieces.push({ start: from, end: s.start });
    from = Math.max(from, s.end);
  }
  if (from < run.end) pieces.push({ start: from, end: run.end });
  return pieces.flatMap((piece) =>
    otherScriptPassages(text.slice(piece.start, piece.end)).map((r) => ({ start: piece.start + r.start, end: piece.start + r.end })),
  );
}

/**
 * The passages the check did not read inside the paragraphs it did check: other-script runs plus the foreign
 * sentences setup already found, in document order. Set-aside paragraphs (#2a) are skipped, a block marker covers them.
 */
export function uncheckedPassages(
  paras: readonly Paragraph[],
  setAside: ReadonlySet<number>,
  foreignSentences: ReadonlyMap<number, Span[]>,
): UncheckedPassage[] {
  return paras
    .filter((p) => !setAside.has(p.id))
    .flatMap((p) => {
      const sentences = foreignSentences.get(p.id) ?? [];
      // A foreign sentence covers the runs inside it; what a run has outside it is still reported, so passages never overlap.
      const runs = otherScriptPassages(p.text).flatMap((r) => outsideSentences(p.text, r, sentences));
      return [
        ...runs.map((span) => ({ paraId: p.id, span, kind: 'otherScript' as const })),
        ...sentences.map((span) => ({ paraId: p.id, span, kind: 'otherLanguage' as const })),
      ].sort((a, b) => a.span.start - b.span.start);
    });
}

/** How much of a document the English-only check could not read (review #4: no false all-clear). */
export interface UncheckedText {
  /** Paragraphs mostly in a script other than Latin. */
  paragraphs: number;
  /** True when other scripts hold most of the document's letters: little or no English was checked. */
  mostly: boolean;
}

const count = (text: string, letters: RegExp) => text.match(letters)?.length ?? 0;

/** The ids of the paragraphs whose letters are mostly not Latin: the check sets them aside (#2a), in document order. */
export function otherScriptParagraphIds(paras: readonly Paragraph[]): number[] {
  return paras.filter((p) => count(p.text, OTHER_SCRIPT_LETTER) > count(p.text, LATIN_LETTER)).map((p) => p.id);
}

/** The text in `paras` in a language the checker can't check yet (any script but Latin), which it skipped. */
export function uncheckedText(paras: readonly Paragraph[]): UncheckedText {
  let latin = 0;
  let other = 0;
  let paragraphs = 0;
  for (const p of paras) {
    const l = count(p.text, LATIN_LETTER);
    const o = count(p.text, OTHER_SCRIPT_LETTER);
    latin += l;
    other += o;
    if (o > l) paragraphs++;
  }
  return { paragraphs, mostly: other > latin };
}
