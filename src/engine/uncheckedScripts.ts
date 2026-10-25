import type { Paragraph } from './types';

/** A letter of the script the checker reads (English): "a", "é". */
const LATIN_LETTER = /\p{Script=Latin}/gu;
/**
 * A letter or sign of any other script, which the checker can't check yet: Hindi "क", Bengali "ো", Tamil "த",
 * Urdu "ب", Russian "д". Accents (Inherited), digits, punctuation and emoji (Common) are no language.
 */
const OTHER_SCRIPT_LETTER = /(?![\p{Script=Latin}\p{Script=Inherited}\p{Script=Common}])[\p{L}\p{M}]/gu;

/** How much of a document the English-only check could not read (review #4: no false all-clear). */
export interface UncheckedText {
  /** Paragraphs mostly in a script other than Latin. */
  paragraphs: number;
  /** True when other scripts hold most of the document's letters: little or no English was checked. */
  mostly: boolean;
}

const count = (text: string, letters: RegExp) => text.match(letters)?.length ?? 0;

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
