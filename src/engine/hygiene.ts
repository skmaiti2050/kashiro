import type { Candidate, Paragraph, Span } from './types';

const NAMES: Record<number, string> = {
  0x200b: 'ZERO WIDTH SPACE',
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER',
  0x2060: 'WORD JOINER',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE',
  0x00ad: 'SOFT HYPHEN',
  0x180e: 'MONGOLIAN VOWEL SEPARATOR',
  0x202a: 'LEFT-TO-RIGHT EMBEDDING',
  0x202b: 'RIGHT-TO-LEFT EMBEDDING',
  0x202c: 'POP DIRECTIONAL FORMATTING',
  0x202d: 'LEFT-TO-RIGHT OVERRIDE',
  0x202e: 'RIGHT-TO-LEFT OVERRIDE',
};

/**
 * A letter or mark of a script where ZWJ/ZWNJ (and soft hyphen) can be meaningful: any script but Latin, Greek
 * and Cyrillic: Indic conjuncts, Persian, Myanmar, Khmer (Task F4: never remove them there).
 */
const JOINER_SCRIPT = /(?![\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}])[\p{L}\p{M}]/u;
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{20E3}]/u;
/** Right-to-left letters, e.g. Hebrew "ש" or Arabic "ب": a paragraph with them may need its direction controls. */
const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const MONGOLIAN = /\p{Script=Mongolian}/u;

const isDirectionControl = (code: number) => code >= 0x202a && code <= 0x202e;
/** U+202C POP DIRECTIONAL FORMATTING ends the embedding or override (U+202A, 202B, 202D, 202E) last opened. */
const DIRECTION_END = 0x202c;
/** U+2066–2068 start an isolate; U+2069 POP DIRECTIONAL ISOLATE ends it and every embedding opened inside it. */
const isIsolateStart = (code: number) => code >= 0x2066 && code <= 0x2068;
const ISOLATE_END = 0x2069;

/** The message of a direction control hygiene reports but leaves in place (findInvisible). */
export const DIRECTION_KEPT = 'Direction character left in place';

/**
 * Offsets of the direction controls hygiene may delete: an opener and the U+202C that ends it, as a pair, when
 * neither is inside a `locked` span. Deleting one end alone leaves the other reversing (or ending) the rest of
 * the paragraph, text the user never touched (F3 re-review, D3). Pairs are matched as UAX #9 does: a U+202C ends
 * only an embedding opened inside the current isolate, and a U+2069 ends the embeddings left open inside its
 * isolate, which then have no U+202C partner (F3 re-review 2, I-2). Isolates themselves are never deleted.
 */
function deletableDirectionPairs(text: string, locked: readonly Span[]): Set<number> {
  const isLocked = (i: number) => locked.some((s) => s.start <= i && i < s.end);
  const open: { at: number; isolate: boolean }[] = [];
  const out = new Set<number>();
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isIsolateStart(code) || (isDirectionControl(code) && code !== DIRECTION_END)) {
      open.push({ at: i, isolate: isIsolateStart(code) });
    } else if (code === ISOLATE_END) {
      if (open.some((o) => o.isolate)) while (!open.pop()!.isolate);
    } else if (code === DIRECTION_END) {
      const opener = open.at(-1);
      if (opener === undefined || opener.isolate) continue;
      open.pop();
      if (isLocked(opener.at) || isLocked(i)) continue;
      out.add(opener.at);
      out.add(i);
    }
  }
  return out;
}

function charBefore(text: string, i: number): string {
  if (i <= 0) return '';
  const lo = text.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = text.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return text.slice(i - 2, i);
  }
  return text[i - 1];
}

function charAfter(text: string, i: number): string {
  const cp = text.codePointAt(i);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/** True when the script around the character at `i` needs it (Indic joiners, emoji sequences, RTL text, Mongolian). */
function isMeaningful(text: string, i: number, code: number): boolean {
  const prev = charBefore(text, i);
  const next = charAfter(text, i + 1);
  if (code === 0x200c || code === 0x200d || code === 0x00ad) {
    if (JOINER_SCRIPT.test(prev) || JOINER_SCRIPT.test(next)) return true;
    if (code !== 0x00ad && (EMOJI.test(prev) || EMOJI.test(next))) return true;
  }
  if (isDirectionControl(code)) return RTL_SCRIPT.test(text);
  if (code === 0x180e) return MONGOLIAN.test(prev) || MONGOLIAN.test(next);
  return false;
}

/**
 * Flags zero-width/invisible junk and stray direction controls; leaves what Indic, Arabic-script, RTL, Mongolian
 * and emoji text rely on. A direction control is deleted only with its partner and outside `locked` spans
 * (deletableDirectionPairs); any other is reported without a fix.
 */
export function findInvisible(p: Paragraph, locked: readonly Span[] = []): Candidate[] {
  const out: Candidate[] = [];
  const text = p.text;
  const deletablePairs = deletableDirectionPairs(text, locked);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (!(code in NAMES) || isMeaningful(text, i, code)) continue;
    const kept = isDirectionControl(code) && !deletablePairs.has(i);
    out.push({
      id: `${p.id}:${i}:${i + 1}:Invisible`,
      paraId: p.id,
      span: { start: i, end: i + 1 },
      original: text[i],
      replacements: kept ? [] : [''],
      kind: 'Invisible',
      message: `${kept ? DIRECTION_KEPT : 'Invisible character'} (U+${code.toString(16).toUpperCase().padStart(4, '0')} ${NAMES[code]})`,
      source: 'hygiene',
    });
  }
  return out;
}

/** A paragraph's text without the characters findInvisible flagged, and the way back to the paragraph's offsets. */
export interface VisibleText {
  text: string;
  /** A span of `text` as a span of the paragraph. One that straddles an invisible character covers it there too. */
  toParagraph(span: Span): Span;
}

/**
 * The paragraph as the reader sees it, so the linter reads "m<U+2060>ean" as "mean" and "mod<U+200B>els" as
 * "models" instead of flagging the pieces (review #4, C3). `invisible` is findInvisible's result.
 */
export function visibleText(p: Paragraph, invisible: Candidate[]): VisibleText {
  if (invisible.length === 0) return { text: p.text, toParagraph: (span) => ({ ...span }) };
  const removed = new Set(invisible.map((c) => c.span.start));
  /** Index in `text` → index in the paragraph. */
  const kept: number[] = [];
  const parts: string[] = [];
  for (let i = 0; i < p.text.length; i++) {
    if (removed.has(i)) continue;
    kept.push(i);
    parts.push(p.text[i]);
  }
  const at = (i: number) => (i < kept.length ? kept[i] : p.text.length);
  return {
    text: parts.join(''),
    // A non-empty span ends right after its last character, not before the next one: "teh<U+200B> " → "teh".
    toParagraph: ({ start, end }) => ({ start: at(start), end: start === end ? at(start) : kept[end - 1] + 1 }),
  };
}
