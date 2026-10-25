import type { Edit } from './sessionTypes';

/**
 * The backstop on every change made without a click (owner decision, Task F4). It knows nothing of rules or
 * tiers on purpose: whatever a future rule gets wrong, a paragraph may only lose invisible characters and have
 * the whitespace between its tokens changed. A token is a maximal run of characters that are neither
 * whitespace nor invisible, so case, punctuation, hyphens, apostrophes and slashes all count.
 */

/** Invisible and format characters (joiners, direction marks, variation selectors, tags): removing one is allowed. */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const WHITESPACE = /\s+/u;

function tokens(text: string): string[] {
  return text.replace(INVISIBLE, '').split(WHITESPACE).filter((token) => token !== '');
}

/** True when `after` has exactly the tokens of `before`, in order: "went  home" → "went home", not "Govt. of" → "Govt. Of". */
export function keepsTokens(before: string, after: string): boolean {
  const a = tokens(before);
  const b = tokens(after);
  return a.length === b.length && a.every((token, i) => token === b[i]);
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
 */
export function editsChangingTokens(text: string, edits: readonly Edit[]): number[] {
  if (keepsTokens(text, withEdits(text, edits))) return [];
  const bad = edits.flatMap((e, i) => (keepsTokens(text, withEdits(text, [e])) ? [] : [i]));
  const rest = edits.filter((_, i) => !bad.includes(i));
  return keepsTokens(text, withEdits(text, rest)) ? bad : edits.map((_, i) => i);
}
