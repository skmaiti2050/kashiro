/**
 * Offset-preserving text extraction from word/document.xml.
 *
 * One forward scan over the tokens, tracking a stack of open elements. No DOM and no re-serialisation:
 * every piece of paragraph text records where it lives in the ORIGINAL xml string, so the writer
 * (Task 9) can splice tracked changes into exactly those ranges and leave all other bytes untouched.
 *
 * Namespace assumption: elements are matched by their conventional qualified names (`w:` for
 * WordprocessingML, `mc:` for Markup Compatibility), not by resolved namespace URI. Word and every
 * mainstream producer use these prefixes; a document that binds the namespaces to other prefixes
 * would extract as empty paragraphs (safe: nothing to edit), never as wrong offsets.
 */
import type { Paragraph, Span } from '../../engine/types';
import { tokenize, attr, decodeXmlText, type Token } from './tokenize';

export interface TextPiece {
  /** UTF-16 offset of this piece within para.text. */
  paraOffset: number;
  /** Decoded UTF-16 length (1 for specials). */
  length: number;
  /** kind 'text': the raw, still-escaped content between `<w:t …>` and `</w:t>`. kind 'special': the whole element. */
  xmlStart: number;
  xmlEnd: number;
  /** The enclosing `<w:r>…</w:r>` range. */
  runStart: number;
  runEnd: number;
  /** Verbatim `<w:rPr>…</w:rPr>` of the run, '' if none. */
  rPr: string;
  kind: 'text' | 'special';
  container: 'plain' | 'hyperlink' | 'ins' | 'field';
}

export interface DocxPara {
  para: Paragraph;
  pieces: TextPiece[];
}

/** Run children that render as one character. They are locked: the writer must not edit across them. */
const SPECIAL: Record<string, string> = {
  'w:tab': '\t',
  'w:ptab': '\t', // positional tab: renders as a tab; without it adjacent words would fuse
  'w:br': '\n',
  'w:cr': '\n',
  'w:sym': '￼',
  'w:noBreakHyphen': '￼',
  'w:softHyphen': '￼',
};

/**
 * Subtrees whose text is not part of the visible document. mc:Fallback duplicates mc:Choice, so
 * paragraphs inside it are skipped too (editing both copies would double-apply).
 * w:delText / w:instrText are never read anyway (only w:t is), listed for clarity.
 */
const EXCLUDED = new Set(['w:del', 'w:moveFrom', 'w:delText', 'w:instrText', 'mc:Fallback']);

interface RunState {
  start: number;
  rPr: string;
  pieces: TextPiece[];
}

interface ParaState {
  dp: DocxPara;
  text: string;
  locked: Span[];
}

interface Frame {
  name: string;
  start: number;
  /** End of the open tag. */
  openEnd: number;
  role?: 'para' | 'run' | 'rPr' | 't' | 'special' | 'excluded' | 'fallback' | 'hyperlink' | 'ins' | 'fldSimple';
}

/** Merge a span into a sorted list, coalescing touching/overlapping spans. Spans arrive in order. */
function addLocked(locked: Span[], s: Span) {
  const last = locked[locked.length - 1];
  if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
  else locked.push({ ...s });
}

export function extractDocx(documentXml: string, firstId: number): DocxPara[] {
  const xml = documentXml;
  const out: DocxPara[] = [];
  const stack: Frame[] = [];
  const paras: ParaState[] = [];
  const runs: RunState[] = [];
  let excluded = 0; // inside w:del / w:moveFrom / mc:Fallback / delText / instrText
  let fallback = 0; // inside mc:Fallback (also counted in `excluded`)
  let hyperlink = 0;
  let ins = 0;
  let fldSimple = 0;
  /**
   * Complex fields, outermost first. Fields may span paragraphs and nest. Text is visible only when every
   * open field is in its result phase: text in an instruction phase (including a nested field's result that
   * feeds the outer instruction) is field code, not displayed content.
   */
  const fields: ('instr' | 'result')[] = [];

  const visible = () => excluded === 0 && paras.length > 0 && runs.length > 0 && fields.every((f) => f === 'result');

  function emit(kind: 'text' | 'special', value: string, xmlStart: number, xmlEnd: number) {
    if (!visible() || value.length === 0) return;
    const p = paras[paras.length - 1];
    const run = runs[runs.length - 1];
    const container: TextPiece['container'] =
      ins > 0 ? 'ins' : fields.length > 0 || fldSimple > 0 ? 'field' : hyperlink > 0 ? 'hyperlink' : 'plain';
    const piece: TextPiece = {
      paraOffset: p.text.length,
      length: value.length,
      xmlStart,
      xmlEnd,
      runStart: run.start,
      runEnd: -1, // filled when the run closes
      rPr: '',
      kind,
      container,
    };
    p.text += value;
    if (kind === 'special' || container === 'ins' || container === 'field') {
      addLocked(p.locked, { start: piece.paraOffset, end: piece.paraOffset + piece.length });
    }
    run.pieces.push(piece);
    p.dp.pieces.push(piece);
  }

  function onFldChar(tok: Token & { kind: 'open' }) {
    const type = attr(xml, tok, 'w:fldCharType');
    if (type === 'begin') fields.push('instr');
    else if (type === 'separate') {
      if (fields.length) fields[fields.length - 1] = 'result';
    } else if (type === 'end') fields.pop();
  }

  /** Handle an open tag; returns the frame role (for non-self-closing tags pushed on the stack). */
  function open(tok: Token & { kind: 'open' }, parent: string | undefined): Frame['role'] {
    const name = tok.name;
    if (name === 'mc:Fallback') {
      excluded++;
      fallback++;
      return 'fallback';
    }
    // Field characters inside deleted/moved-from runs still delimit fields; inside Fallback they are duplicates.
    if (name === 'w:fldChar') {
      if (fallback === 0) onFldChar(tok);
      return undefined;
    }
    if (EXCLUDED.has(name)) {
      excluded++;
      return 'excluded';
    }
    if (excluded > 0) return undefined;
    switch (name) {
      case 'w:p': {
        const dp: DocxPara = { para: { id: firstId + out.length, text: '' }, pieces: [] };
        out.push(dp);
        paras.push({ dp, text: '', locked: [] });
        return 'para';
      }
      case 'w:r':
        runs.push({ start: tok.start, rPr: '', pieces: [] });
        return 'run';
      case 'w:rPr':
        if (parent === 'w:r') {
          if (tok.selfClosing && runs.length) runs[runs.length - 1].rPr = xml.slice(tok.start, tok.end);
          return 'rPr';
        }
        return undefined;
      case 'w:t':
        return parent === 'w:r' ? 't' : undefined;
      case 'w:hyperlink':
        hyperlink++;
        return 'hyperlink';
      case 'w:ins':
      case 'w:moveTo':
        ins++;
        return 'ins';
      case 'w:fldSimple':
        fldSimple++;
        return 'fldSimple';
    }
    if (name in SPECIAL && parent === 'w:r') {
      if (tok.selfClosing) emit('special', SPECIAL[name], tok.start, tok.end);
      return 'special';
    }
    return undefined;
  }

  function close(frame: Frame, closeTok: { start: number; end: number }) {
    switch (frame.role) {
      case 'fallback':
        fallback--;
        excluded--;
        break;
      case 'excluded':
        excluded--;
        break;
      case 'para': {
        const p = paras.pop()!;
        p.dp.para.text = p.text;
        if (p.locked.length) p.dp.para.locked = p.locked;
        break;
      }
      case 'run': {
        const run = runs.pop()!;
        for (const pc of run.pieces) {
          pc.runEnd = closeTok.end;
          pc.rPr = run.rPr;
        }
        break;
      }
      case 'rPr':
        if (runs.length) runs[runs.length - 1].rPr = xml.slice(frame.start, closeTok.end);
        break;
      case 't':
        emit('text', decodeXmlText(xml.slice(frame.openEnd, closeTok.start)), frame.openEnd, closeTok.start);
        break;
      case 'special':
        emit('special', SPECIAL[frame.name], frame.start, closeTok.end);
        break;
      case 'hyperlink':
        hyperlink--;
        break;
      case 'ins':
        ins--;
        break;
      case 'fldSimple':
        fldSimple--;
        break;
    }
  }

  for (const tok of tokenize(xml)) {
    if (tok.kind === 'open') {
      const parent = stack.length ? stack[stack.length - 1].name : undefined;
      const role = open(tok, parent);
      const frame: Frame = { name: tok.name, start: tok.start, openEnd: tok.end, role };
      if (tok.selfClosing) {
        // Self-closing: open() already did the leaf work; undo any counter/stack it pushed.
        if (role !== 'rPr' && role !== 'special' && role !== 't') close(frame, tok);
      } else stack.push(frame);
    } else if (tok.kind === 'close') {
      const frame = stack.pop();
      if (!frame || frame.name !== tok.name) {
        throw new Error(`malformed document.xml: </${tok.name}> at ${tok.start} does not close <${frame?.name ?? '(none)'}>`);
      }
      close(frame, tok);
    }
    // text/cdata/comment/pi tokens outside w:t carry no paragraph text; w:t content is decoded at </w:t>.
  }
  if (stack.length) throw new Error(`malformed document.xml: <${stack[stack.length - 1].name}> never closed`);
  return out;
}
