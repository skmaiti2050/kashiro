import type { Paragraph } from './types';

/** A letter of the scripts the checker reads (English): "a", "é". */
const LATIN_LETTER = /\p{Script=Latin}/gu;
/** A letter or sign of Hindi or Bengali text, which the checker can't check yet: "क", "ো". */
const INDIC_LETTER = /[\p{Script=Devanagari}\p{Script=Bengali}]/gu;

/** How much of a document the English-only check could not read (review #4: no false all-clear). */
export interface UncheckedText {
  /** Paragraphs mostly in Devanagari or Bengali script. */
  paragraphs: number;
  /** True when Devanagari and Bengali hold most of the document's letters: little or no English was checked. */
  mostly: boolean;
}

const count = (text: string, letters: RegExp) => text.match(letters)?.length ?? 0;

/** The Hindi and Bengali text in `paras`, which the checker skipped. */
export function uncheckedText(paras: readonly Paragraph[]): UncheckedText {
  let latin = 0;
  let indic = 0;
  let paragraphs = 0;
  for (const p of paras) {
    const l = count(p.text, LATIN_LETTER);
    const i = count(p.text, INDIC_LETTER);
    latin += l;
    indic += i;
    if (i > l) paragraphs++;
  }
  return { paragraphs, mostly: indic > latin };
}
