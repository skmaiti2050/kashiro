import type { Edit } from './sessionTypes';

/**
 * The backstop on every change made without a click (owner decision, Task F4). It knows nothing of rules or
 * tiers on purpose: whatever a future rule gets wrong, a paragraph may only lose the invisible characters hygiene
 * may remove and have the whitespace between its tokens changed. A token is a maximal run of characters that are
 * neither whitespace nor invisible, so case, punctuation, hyphens, apostrophes and slashes all count. No Unicode
 * normalisation and no case folding: "Café" written two ways, or "कि" losing its vowel sign, is a change.
 */

/** Invisible and format characters (joiners, direction marks, variation selectors, tags). */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const INVISIBLES = new RegExp(INVISIBLE.source, 'gu');
const WHITESPACE = /\s+/u;

function tokens(text: string): string[] {
  return text.replace(INVISIBLES, '').split(WHITESPACE).filter((token) => token !== '');
}

/**
 * True when `after` holds `before`'s invisible characters in order, less some whose offsets are in `removable`:
 * none added ("100" → "1<U+202E>00"), none swapped (ZWJ → ZWNJ, another conjunct) and none removed that hygiene
 * keeps (the ZWJ in "क्<U+200D>ष") (F4 re-review 3, M-1).
 */
function keepsInvisibles(before: string, after: string, removable: ReadonlySet<number>): boolean {
  const kept = [...after].filter((ch) => INVISIBLE.test(ch));
  let k = 0;
  let i = 0;
  for (const ch of before) {
    if (INVISIBLE.test(ch)) {
      if (kept[k] === ch) k++;
      else if (!removable.has(i)) return false;
    }
    i += ch.length;
  }
  return k === kept.length;
}

/**
 * True when `after` has exactly the tokens of `before`, in order, and its invisible characters less only those at
 * offsets in `removable` (what hygiene may delete): "went  home" → "went home", not "Govt. of" → "Govt. Of".
 */
export function keepsTokens(before: string, after: string, removable: ReadonlySet<number>): boolean {
  const a = tokens(before);
  const b = tokens(after);
  return a.length === b.length && a.every((token, i) => token === b[i]) && keepsInvisibles(before, after, removable);
}

/** `text` with `edits` (spans of `text`, not overlapping) applied. */
function withEdits(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const e of [...edits].sort((x, y) => y.span.start - x.span.start)) {
    out = out.slice(0, e.span.start) + e.replacement + out.slice(e.span.end);
  }
  return out;
}

/**
 * The indexes of `edits` (one paragraph's changes made without a click) to take back so the rest keep every
 * token of `text`: each edit that changes a token on its own, and if the others still do together, all of them.
 * `removable`: offsets of the invisible characters hygiene may delete.
 */
export function editsChangingTokens(text: string, edits: readonly Edit[], removable: ReadonlySet<number>): number[] {
  const keeps = (some: readonly Edit[]) => keepsTokens(text, withEdits(text, some), removable);
  if (keeps(edits)) return [];
  const bad = edits.flatMap((e, i) => (keeps([e]) ? [] : [i]));
  const rest = edits.filter((_, i) => !bad.includes(i));
  return keeps(rest) ? bad : edits.map((_, i) => i);
}
