import type { Span } from './types';

/** Why an edit that cuts inside a character is never applied (it would leave half a syllable or emoji behind). */
export const SPLITS_CHARACTER_REASON = 'it would split a character';

/** A Devanagari or Bengali halant (virama): "क्|ष" — the consonant before it joins the next one. */
const HALANT = /[्্]/;

/** Any letter, in any script: the consonant a halant joins ("क्|ष"), not a space or a danda after a final halant. */
const LETTER = /\p{L}/u;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** True when `span.start` or `span.end` falls inside a grapheme cluster of `text`; 0 and `text.length` never do. */
export function splitsCharacter(text: string, span: Span): boolean {
  const segments = segmenter.segment(text);
  const splitsAt = (boundary: number): boolean => {
    if (boundary <= 0 || boundary >= text.length) return false;
    if (segments.containing(boundary)!.index !== boundary) return true;
    // Engines before Unicode 15.1 (older Safari and Firefox) split a conjunct after its halant: keep it whole anyway.
    return HALANT.test(text[boundary - 1]) && LETTER.test(text[boundary]);
  };
  return splitsAt(span.start) || splitsAt(span.end);
}
