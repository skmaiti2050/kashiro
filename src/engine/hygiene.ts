import type { Candidate, Paragraph } from './types';

const NAMES: Record<number, string> = {
  0x200b: 'ZERO WIDTH SPACE',
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER',
  0x2060: 'WORD JOINER',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE',
  0x00ad: 'SOFT HYPHEN',
};

// Scripts where ZWJ/ZWNJ (and soft hyphen) are meaningful or common.
const JOINER_SCRIPT =
  /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Arabic}]/u;
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{20E3}]/u;

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

/** Flags zero-width/invisible junk; leaves joiners that Indic, Arabic-script and emoji text rely on. */
export function findInvisible(p: Paragraph): Candidate[] {
  const out: Candidate[] = [];
  const text = p.text;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (!(code in NAMES)) continue;
    const prev = charBefore(text, i);
    const next = charAfter(text, i + 1);

    if (code === 0x200c || code === 0x200d || code === 0x00ad) {
      if (JOINER_SCRIPT.test(prev) || JOINER_SCRIPT.test(next)) continue;
      if (code !== 0x00ad && (EMOJI.test(prev) || EMOJI.test(next))) continue;
    }

    out.push({
      id: `${p.id}:${i}:${i + 1}:Invisible`,
      paraId: p.id,
      span: { start: i, end: i + 1 },
      original: text[i],
      replacements: [''],
      kind: 'Invisible',
      message: `Invisible character (U+${code.toString(16).toUpperCase().padStart(4, '0')} ${NAMES[code]})`,
      source: 'hygiene',
    });
  }
  return out;
}
