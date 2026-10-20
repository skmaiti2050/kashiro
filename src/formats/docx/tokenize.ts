/**
 * Offset-preserving XML tokenizer for WordprocessingML. Pure TS (no DOM, no Node APIs).
 *
 * Every token carries [start, end) UTF-16 offsets into the original string, so callers can splice the
 * original XML without re-serialising anything. It is a lexer, not a validating parser: it assumes
 * well-formed XML (Word output) and only throws when it cannot find the end of a construct.
 */

export type Token =
  | { kind: 'open'; name: string; start: number; end: number; selfClosing: boolean }
  | { kind: 'close'; name: string; start: number; end: number }
  /** Raw character data, entities still escaped. */
  | { kind: 'text'; start: number; end: number }
  /** Whole `<![CDATA[...]]>` section, markers included. */
  | { kind: 'cdata'; start: number; end: number }
  | { kind: 'comment'; start: number; end: number }
  | { kind: 'pi'; start: number; end: number }
  | { kind: 'doctype'; start: number; end: number };

function need(xml: string, needle: string, from: number, what: string): number {
  const i = xml.indexOf(needle, from);
  if (i < 0) throw new Error(`malformed XML: unterminated ${what} at ${from}`);
  return i + needle.length;
}

/** End offset (exclusive) of the tag starting at `start` ('<'), honouring quoted attribute values that may contain '>'. */
function tagEnd(xml: string, start: number): number {
  let quote = '';
  for (let i = start + 1; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i + 1;
  }
  throw new Error(`malformed XML: unterminated tag at ${start}`);
}

const NAME_END = /[\s/>]/;

function tagName(xml: string, from: number): string {
  let i = from;
  while (i < xml.length && !NAME_END.test(xml[i])) i++;
  return xml.slice(from, i);
}

export function* tokenize(xml: string): Generator<Token> {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      yield { kind: 'text', start: i, end: n };
      return;
    }
    if (lt > i) yield { kind: 'text', start: i, end: lt };
    if (xml.startsWith('<!--', lt)) {
      i = need(xml, '-->', lt + 4, 'comment');
      yield { kind: 'comment', start: lt, end: i };
    } else if (xml.startsWith('<![CDATA[', lt)) {
      i = need(xml, ']]>', lt + 9, 'CDATA');
      yield { kind: 'cdata', start: lt, end: i };
    } else if (xml.startsWith('<?', lt)) {
      i = need(xml, '?>', lt + 2, 'processing instruction');
      yield { kind: 'pi', start: lt, end: i };
    } else if (xml.startsWith('<!', lt)) {
      // DOCTYPE (Word never emits one); an internal subset in [...] is skipped wholesale.
      const bracket = xml.indexOf('[', lt);
      const close = xml.indexOf('>', lt);
      i = bracket >= 0 && bracket < close ? need(xml, '>', need(xml, ']', bracket, 'DOCTYPE'), 'DOCTYPE') : need(xml, '>', lt, 'DOCTYPE');
      yield { kind: 'doctype', start: lt, end: i };
    } else if (xml[lt + 1] === '/') {
      i = tagEnd(xml, lt);
      yield { kind: 'close', name: tagName(xml, lt + 2), start: lt, end: i };
    } else {
      i = tagEnd(xml, lt);
      yield { kind: 'open', name: tagName(xml, lt + 1), start: lt, end: i, selfClosing: xml[i - 2] === '/' };
    }
  }
}

const ATTR = /\s([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Decoded value of attribute `name` on the open tag `tok`, or undefined. */
export function attr(xml: string, tok: { start: number; end: number }, name: string): string | undefined {
  const tag = xml.slice(tok.start, tok.end);
  for (const m of tag.matchAll(ATTR)) {
    if (m[1] === name) return decodeEntities(m[2] ?? m[3]);
  }
  return undefined;
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Decode the 5 predefined entities and decimal/hex character references (astral → surrogate pairs). */
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&([^;&\s]*);?/g, (whole, body: string) => {
    if (!whole.endsWith(';')) throw new Error(`malformed XML: bare '&' in "${s}"`);
    if (body in NAMED) return NAMED[body];
    const m = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(body);
    if (m) {
      const cp = m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2], 10);
      // XML 1.0 Char production: no NUL/C0 controls (except tab, LF, CR), no lone surrogates, no U+FFFE/U+FFFF.
      const legal =
        cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
      if (!legal) throw new Error(`malformed XML: illegal character reference &${body};`);
      return String.fromCodePoint(cp);
    }
    throw new Error(`malformed XML: unknown entity &${body};`);
  });
}

/**
 * Decode raw element content (e.g. what sits between `<w:t>` and `</w:t>`): entities and character
 * references decoded, CDATA taken literally, comments and processing instructions dropped.
 * Throws if the content contains an element.
 */
export function decodeXmlText(raw: string): string {
  if (!raw.includes('<')) return decodeEntities(raw);
  let out = '';
  for (const tok of tokenize(raw)) {
    if (tok.kind === 'text') out += decodeEntities(raw.slice(tok.start, tok.end));
    else if (tok.kind === 'cdata') out += raw.slice(tok.start + 9, tok.end - 3);
    else if (tok.kind === 'comment' || tok.kind === 'pi') continue;
    else throw new Error(`unexpected markup in text content: ${raw.slice(tok.start, tok.end)}`);
  }
  return out;
}

interface RawUnit {
  raw: string;
  /** Decoded UTF-16 length: 0 for comments/PIs, 2 for an astral character reference, else 1. */
  len: number;
  /** Index of the CDATA section this character came from, or -1. */
  cdata: number;
}

function rawUnits(raw: string): RawUnit[] {
  const units: RawUnit[] = [];
  let cdataIndex = 0;
  const toks: Token[] = raw.includes('<') ? [...tokenize(raw)] : [{ kind: 'text', start: 0, end: raw.length }];
  for (const tok of toks) {
    if (tok.kind === 'text') {
      for (let i = tok.start; i < tok.end; ) {
        if (raw[i] === '&') {
          const semi = raw.indexOf(';', i);
          if (semi < 0 || semi >= tok.end) throw new Error(`malformed XML: bare '&' in "${raw}"`);
          const ent = raw.slice(i, semi + 1);
          units.push({ raw: ent, len: decodeEntities(ent).length, cdata: -1 });
          i = semi + 1;
        } else {
          units.push({ raw: raw[i], len: 1, cdata: -1 });
          i++;
        }
      }
    } else if (tok.kind === 'cdata') {
      const id = cdataIndex++;
      for (let i = tok.start + 9; i < tok.end - 3; i++) units.push({ raw: raw[i], len: 1, cdata: id });
    } else if (tok.kind === 'comment' || tok.kind === 'pi') {
      units.push({ raw: raw.slice(tok.start, tok.end), len: 0, cdata: -1 });
    } else throw new Error(`unexpected markup in text content: ${raw.slice(tok.start, tok.end)}`);
  }
  return units;
}

/**
 * The decoded → raw offset mapper. Splits RAW element content (as between `<w:t>` and `</w:t>`) at DECODED
 * offsets `cuts` (sorted ascending, duplicates allowed) into cuts.length + 1 raw strings that are each valid
 * element content and whose decodings are the corresponding slices of decodeXmlText(raw). Entities are kept
 * as written; a CDATA section cut in its interior is closed and reopened. Comments/PIs go to the later part.
 * Throws if a cut falls inside one entity (an astral character reference decodes to two UTF-16 units).
 */
export function splitRawText(raw: string, cuts: number[]): string[] {
  const parts: { raw: string; cdata: number }[][] = cuts.map(() => []);
  parts.push([]);
  let pos = 0;
  for (const u of rawUnits(raw)) {
    if (u.len === 2 && cuts.some((c) => c > pos && c < pos + 2)) throw new Error('cut inside a character reference');
    let k = 0;
    while (k < cuts.length && cuts[k] <= pos) k++;
    const part = parts[k];
    const last = part[part.length - 1];
    if (u.cdata >= 0 && last && last.cdata === u.cdata) last.raw += u.raw;
    else part.push({ raw: u.raw, cdata: u.cdata });
    pos += u.len;
  }
  return parts.map((segs) => segs.map((s) => (s.cdata >= 0 ? `<![CDATA[${s.raw}]]>` : s.raw)).join(''));
}
