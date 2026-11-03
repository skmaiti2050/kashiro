import type { Edit } from './sessionTypes';

/**
 * The backstop on every change made without a click (owner decision, Task F4). It knows nothing of rules or
 * tiers on purpose: whatever a future rule gets wrong, a paragraph may only lose the invisible characters hygiene
 * may remove and have the whitespace between its tokens changed, and keeps every other invisible character
 * between the same visible characters. A token is a maximal run of characters that are
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
 * True when `edit` adds no invisible character ("100" → "1<U+202E>00", ZWJ → ZWNJ) and removes only those at
 * offsets in `removable`, not one hygiene keeps (the ZWJ in "क्<U+200D>ष") (F4 re-review 3, M-1). Matched by
 * offset, not by character: of two identical joiners only the removable one may go (F5 re-review 4, M-2).
 */
function keepsInvisibles(text: string, edit: Edit, removable: ReadonlySet<number>): boolean {
  if (INVISIBLE.test(edit.replacement)) return false;
  for (let i = edit.span.start; i < edit.span.end; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    if (INVISIBLE.test(ch) && !removable.has(i)) return false;
    i += ch.length;
  }
  return true;
}

/**
 * True when `text` with `edits` applied has exactly its tokens, in order, and the edits touch its invisible
 * characters only by deleting those at offsets in `removable` (what hygiene may delete): "went  home" → "went
 * home", not "Govt. of" → "Govt. Of".
 */
export function keepsTokens(text: string, edits: readonly Edit[], removable: ReadonlySet<number>): boolean {
  const a = tokens(text);
  const edited = withEdits(text, edits);
  const b = tokens(edited);
  return (
    a.length === b.length &&
    a.every((token, i) => token === b[i]) &&
    edits.every((e) => keepsInvisibles(text, e, removable)) &&
    sameList(invisibleAnchors(text, deletedInvisibles(edits, removable)), invisibleAnchors(edited, NO_OFFSETS))
  );
}

const NO_OFFSETS: ReadonlySet<number> = new Set();
/** One whitespace or invisible character: " ", "\n", a ZWJ. Neither counts towards an anchor. */
const SPACE_OR_INVISIBLE = /^[\s\p{Cf}\p{Default_Ignorable_Code_Point}]$/u;

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** The offsets in `removable` that lie inside an edit's span (start <= offset < end): the ones the edits delete. */
function deletedInvisibles(edits: readonly Edit[], removable: ReadonlySet<number>): Set<number> {
  return new Set([...removable].filter((offset) => edits.some((e) => e.span.start <= offset && offset < e.span.end)));
}

/**
 * "<character>@<anchor>" for each invisible character of `text` not in `skip`, in order. The anchor is the count
 * of UTF-16 units before it that are neither whitespace nor invisible, so whitespace changes leave it alone and
 * moving text across the character changes it (#10).
 */
function invisibleAnchors(text: string, skip: ReadonlySet<number>): string[] {
  const anchors: string[] = [];
  let visible = 0;
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    if (INVISIBLE.test(ch)) {
      if (!skip.has(i)) anchors.push(`${ch}@${visible}`);
    } else if (!SPACE_OR_INVISIBLE.test(ch)) {
      visible += ch.length;
    }
    i += ch.length;
  }
  return anchors;
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
  const keeps = (some: readonly Edit[]) => keepsTokens(text, some, removable);
  if (keeps(edits)) return [];
  const bad = edits.flatMap((e, i) => (keeps([e]) ? [] : [i]));
  const rest = edits.filter((_, i) => !bad.includes(i));
  return keeps(rest) ? bad : edits.map((_, i) => i);
}
