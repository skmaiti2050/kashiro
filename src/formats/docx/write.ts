/**
 * Writes accepted edits back into word/document.xml, either as native tracked changes (w:del / w:ins with
 * author "Kashiro") or cleanly (text replaced in place). Pure string splicing on the original XML:
 * everything outside the rewritten runs (or, in clean mode, the rewritten w:t elements) keeps its exact bytes.
 *
 * Safety model: an edit is either placed whole or returned as unplaceable with a reason; never half-applied.
 * Before returning, the new XML is re-extracted and its visible text compared with the expected text; any
 * mismatch throws instead of producing a damaged document.
 */
import type { Edit } from '../../engine/session';
import type { Span } from '../../engine/types';
import type { SaveMode } from '../types';
import { extractDocx, type DocxPara, type TextPiece } from './extract';
import { splitRawText, tokenize } from './tokenize';

const REVISION_AUTHOR = 'Kashiro';

export interface Unplaceable {
  edit: Edit;
  reason: string;
}

/** A piece-local slice [from, to) of one text piece covered by an edit. */
interface Seg {
  pc: TextPiece;
  from: number;
  to: number;
}

interface Plan {
  edit: Edit;
  /** In document order. A pure insertion has one segment with from === to. */
  segs: Seg[];
}

const TRACKED_CHANGE = 'inside an existing tracked change';

/** Zero-width markers that may sit between the runs of one edit; they are kept where they are. */
const ALLOWED_BETWEEN = new Set([
  'w:t',
  'w:r',
  'w:proofErr',
  'w:bookmarkStart',
  'w:bookmarkEnd',
  'w:commentRangeStart',
  'w:commentRangeEnd',
  'w:permStart',
  'w:permEnd',
  'w:lastRenderedPageBreak',
]);

const ILLEGAL_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const isHigh = (c: string | undefined) => c !== undefined && c >= '\uD800' && c <= '\uDBFF';
const isLow = (c: string | undefined) => c !== undefined && c >= '\uDC00' && c <= '\uDFFF';

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `<w:t …>` open tag with xml:space="preserve" (needed whenever a w:t is split or rewritten). */
function withPreserve(openTag: string): string {
  if (/\sxml:space\s*=/.test(openTag)) return openTag.replace(/(\sxml:space\s*=\s*)(["'])[^"']*\2/, '$1"preserve"');
  return openTag.replace(/\s*(\/?)>$/, ' xml:space="preserve"$1>');
}

function overlapsLocked(locked: Span[] | undefined, start: number, end: number): boolean {
  if (!locked) return false;
  return locked.some((l) => (start === end ? l.start < start && start < l.end : l.start < end && start < l.end));
}

/** Overlap between two edits, matching the session's rule (zero-width spans clash at the same point or inside). */
function editsClash(a: Span, b: Span): boolean {
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  if (a.start === a.end) return b.start < a.start && a.start < b.end;
  if (b.start === b.end) return a.start < b.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

/** Why `pc` may not be edited, or null. */
function pieceProblem(dp: DocxPara, pc: TextPiece): string | null {
  if (pc.container === 'ins') return TRACKED_CHANGE;
  if (pc.container === 'field') return 'touches a field (e.g. a cross-reference or page number)';
  if (pc.kind === 'special') return 'touches a tab, line break or embedded object';
  if (overlapsLocked(dp.para.locked, pc.paraOffset, pc.paraOffset + pc.length)) return 'touches hidden text';
  return null;
}

/** Why the XML between two consecutive segments (end of one w:t content to start of the next) is unsafe to edit across, or null. */
function betweenProblem(xml: string, from: number, to: number): string | null {
  if (to < from) return 'crosses other document content';
  const region = xml.slice(from, to);
  let rPrDepth = 0;
  for (const tok of tokenize(region)) {
    if (tok.kind === 'comment' || tok.kind === 'pi') continue;
    if (tok.kind === 'text') {
      if (/\S/.test(region.slice(tok.start, tok.end))) return 'crosses other document content';
      continue;
    }
    if (tok.kind !== 'open' && tok.kind !== 'close') return 'crosses other document content';
    if (tok.name === 'w:rPr') {
      if (tok.kind === 'open' && !tok.selfClosing) rPrDepth++;
      else if (tok.kind === 'close') rPrDepth--;
      continue;
    }
    if (rPrDepth > 0) continue; // formatting properties of an intervening run start
    if (ALLOWED_BETWEEN.has(tok.name)) continue;
    if (tok.name === 'w:hyperlink') return 'crosses a hyperlink boundary';
    if (['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'].includes(tok.name)) return 'crosses an existing tracked change';
    if (['w:fldSimple', 'w:fldChar', 'w:instrText'].includes(tok.name)) return 'crosses a field';
    return `crosses other document content (${tok.name})`;
  }
  return null;
}

function plan(xml: string, dp: DocxPara | undefined, edit: Edit, mode: SaveMode): Plan | string {
  if (!dp) return 'paragraph not found';
  const text = dp.para.text;
  const { start, end } = edit.span;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
    return 'span not found in the paragraph (out of range)';
  }
  if (/[\t\n\r]/.test(edit.replacement)) return 'the replacement contains a tab or line break, which cannot be saved as plain text';
  if (ILLEGAL_CHAR.test(edit.replacement)) return 'the replacement contains a character that cannot be saved in a Word document';
  for (const at of [start, end]) {
    if (isHigh(text[at - 1]) && isLow(text[at])) return 'the span splits a character';
  }

  let segs: Seg[];
  if (start < end) {
    const covered = dp.pieces.filter((pc) => pc.paraOffset < end && pc.paraOffset + pc.length > start);
    for (const pc of covered) {
      const why = pieceProblem(dp, pc);
      if (why) return why;
    }
    segs = covered.map((pc) => ({
      pc,
      from: Math.max(0, start - pc.paraOffset),
      to: Math.min(pc.length, end - pc.paraOffset),
    }));
  } else {
    const inside = dp.pieces.find((pc) => pc.paraOffset < start && start < pc.paraOffset + pc.length);
    const before = dp.pieces.find((pc) => pc.paraOffset + pc.length === start);
    const after = dp.pieces.find((pc) => pc.paraOffset === start);
    const options = inside ? [inside] : [before, after].filter((x): x is TextPiece => !!x);
    if (options.length === 0) return 'nowhere to insert text in this paragraph';
    const usable = options.find((pc) => !pieceProblem(dp, pc));
    if (!usable) return pieceProblem(dp, options[0])!;
    const at = start - usable.paraOffset;
    segs = [{ pc: usable, from: at, to: at }];
  }
  if (overlapsLocked(dp.para.locked, start, end)) return 'touches locked content';

  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1].pc;
    const b = segs[i].pc;
    if (a.container !== b.container) return a.container === 'hyperlink' || b.container === 'hyperlink' ? 'crosses a hyperlink boundary' : 'crosses other document content';
    const why = betweenProblem(xml, a.xmlEnd, b.xmlStart);
    if (why) return why;
  }
  for (const s of segs) {
    try {
      splitRawText(xml.slice(s.pc.xmlStart, s.pc.xmlEnd), [s.from, s.to]);
    } catch {
      return 'the span splits a character';
    }
    if (mode === 'tracked' && s.pc.rPr.includes('<w:rPrChange')) return 'the text has a tracked formatting change';
  }
  return { edit, segs };
}

interface RunInfo {
  /** `<w:r …>` start tag, verbatim. */
  startTag: string;
  /** Verbatim `<w:rPr>…</w:rPr>`, '' if none. */
  rPr: string;
  /** Run children other than the rPr, absolute [start, end), name null for character data/comments. */
  children: { start: number; end: number; name: string | null }[];
}

function runInfo(xml: string, runStart: number, runEnd: number): RunInfo {
  const s = xml.slice(runStart, runEnd);
  let startTag = '';
  let rPr = '';
  const children: RunInfo['children'] = [];
  let depth = 0;
  let child: { start: number; name: string } | null = null;
  for (const tok of tokenize(s)) {
    if (depth === 0) {
      if (tok.kind !== 'open' || tok.name !== 'w:r' || tok.selfClosing) throw new Error('internal: not a run');
      startTag = s.slice(tok.start, tok.end);
      depth = 1;
      continue;
    }
    if (depth === 1) {
      if (tok.kind === 'close') {
        depth = 0; // </w:r>
        continue;
      }
      if (tok.kind === 'open') {
        if (tok.selfClosing) {
          if (tok.name === 'w:rPr' && !rPr) rPr = s.slice(tok.start, tok.end);
          else children.push({ start: runStart + tok.start, end: runStart + tok.end, name: tok.name });
        } else {
          child = { start: tok.start, name: tok.name };
          depth = 2;
        }
      } else children.push({ start: runStart + tok.start, end: runStart + tok.end, name: null });
      continue;
    }
    if (tok.kind === 'open' && !tok.selfClosing) depth++;
    else if (tok.kind === 'close') {
      depth--;
      if (depth === 1 && child) {
        if (child.name === 'w:rPr' && !rPr) rPr = s.slice(child.start, tok.end);
        else children.push({ start: runStart + child.start, end: runStart + tok.end, name: child.name });
        child = null;
      }
    }
  }
  return { startTag, rPr, children };
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

interface SegRef {
  seg: Seg;
  plan: Plan;
  last: boolean;
}

function groupBy<K, V>(items: V[], key: (v: V) => K): Map<K, V[]> {
  const m = new Map<K, V[]>();
  for (const v of items) {
    const list = m.get(key(v));
    if (list) list.push(v);
    else m.set(key(v), [v]);
  }
  return m;
}

const bySegPos = (a: SegRef, b: SegRef) => a.seg.pc.xmlStart - b.seg.pc.xmlStart || a.seg.from - b.seg.from || a.seg.to - b.seg.to;

function segRefs(plans: Plan[]): SegRef[] {
  return plans.flatMap((p) => p.segs.map((seg, i) => ({ seg, plan: p, last: i === p.segs.length - 1 })));
}

/** Tracked mode: each run touched by an edit is replaced by prefix run / w:del / w:ins / suffix run(s). */
function trackedSplices(xml: string, plans: Plan[], firstId: number, date: string): Splice[] {
  let nextId = firstId;
  const rev = (tag: 'ins' | 'del', inner: string) =>
    `<w:${tag} w:id="${nextId++}" w:author="${REVISION_AUTHOR}" w:date="${date}">${inner}</w:${tag}>`;
  const infoCache = new Map<number, RunInfo>();
  const info = (pc: TextPiece) => {
    let ri = infoCache.get(pc.runStart);
    if (!ri) infoCache.set(pc.runStart, (ri = runInfo(xml, pc.runStart, pc.runEnd)));
    return ri;
  };
  const groups = [...groupBy(segRefs(plans), (r) => r.seg.pc.runStart).values()].sort((a, b) => a[0].seg.pc.runStart - b[0].seg.pc.runStart);
  const splices: Splice[] = [];
  for (const refs of groups) {
    refs.sort(bySegPos);
    const pc0 = refs[0].seg.pc;
    const ri = info(pc0);
    const head = ri.startTag + ri.rPr;
    let out = '';
    let buf = '';
    const flush = () => {
      if (/\S/.test(buf)) out += head + buf + '</w:r>';
      buf = '';
    };
    for (const child of ri.children) {
      const here = refs.filter((r) => child.name === 'w:t' && child.start < r.seg.pc.xmlStart && r.seg.pc.xmlEnd < child.end);
      if (here.length === 0) {
        buf += xml.slice(child.start, child.end);
        continue;
      }
      const pc = here[0].seg.pc;
      const tOpen = withPreserve(xml.slice(child.start, pc.xmlStart));
      const parts = splitRawText(
        xml.slice(pc.xmlStart, pc.xmlEnd),
        here.flatMap((r) => [r.seg.from, r.seg.to]),
      );
      here.forEach((r, i) => {
        if (parts[2 * i]) buf += tOpen + parts[2 * i] + '</w:t>';
        flush();
        if (r.seg.to > r.seg.from) out += rev('del', `${head}<w:delText xml:space="preserve">${parts[2 * i + 1]}</w:delText></w:r>`);
        if (r.last && r.plan.edit.replacement !== '') {
          const first = info(r.plan.segs[0].pc);
          out += rev('ins', `${first.startTag}${first.rPr}<w:t xml:space="preserve">${escapeText(r.plan.edit.replacement)}</w:t></w:r>`);
        }
      });
      const rest = parts[parts.length - 1];
      if (rest) buf += tOpen + rest + '</w:t>';
    }
    flush();
    splices.push({ start: pc0.runStart, end: pc0.runEnd, text: out });
  }
  return splices;
}

/** Clean mode: replacement written into the first covered w:t, other covered text removed; no revisions. */
function cleanSplices(xml: string, plans: Plan[]): Splice[] {
  const splices: Splice[] = [];
  for (const refs of groupBy(segRefs(plans), (r) => r.seg.pc.xmlStart).values()) {
    refs.sort(bySegPos);
    const pc = refs[0].seg.pc;
    const parts = splitRawText(
      xml.slice(pc.xmlStart, pc.xmlEnd),
      refs.flatMap((r) => [r.seg.from, r.seg.to]),
    );
    let raw = parts[0];
    refs.forEach((r, i) => {
      if (r.seg === r.plan.segs[0]) raw += escapeText(r.plan.edit.replacement);
      raw += parts[2 * i + 2];
    });
    const openStart = xml.lastIndexOf('<', pc.xmlStart - 1);
    const closeEnd = xml.indexOf('>', pc.xmlEnd) + 1;
    const tOpen = withPreserve(xml.slice(openStart, pc.xmlStart));
    splices.push({ start: openStart, end: closeEnd, text: tOpen + raw + '</w:t>' });
  }
  return splices;
}

function applySplices(xml: string, splices: Splice[]): string {
  const sorted = [...splices].sort((a, b) => b.start - a.start);
  let out = xml;
  let limit = Infinity;
  for (const s of sorted) {
    if (s.end > limit) throw new Error('internal: overlapping splices');
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
    limit = s.start;
  }
  return out;
}

/** Largest numeric w:id anywhere in the document (bookmarks, comments, revisions…), or 0. */
function maxId(xml: string): number {
  let max = 0;
  for (const m of xml.matchAll(/\sw:id\s*=\s*["'](-?\d+)["']/g)) max = Math.max(max, Number(m[1]));
  return max;
}

function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Apply `edits` to document.xml. `paras` must be extractDocx(xml, 0) of the same string.
 * Returns the new XML (=== xml when nothing was placed) and the edits that could not be placed.
 */
export function writeDocumentXml(
  xml: string,
  paras: DocxPara[],
  edits: Edit[],
  mode: SaveMode,
  now: Date,
): { xml: string; unplaceable: Unplaceable[] } {
  const byId = new Map(paras.map((d) => [d.para.id, d]));
  const unplaceable: Unplaceable[] = [];
  let plans: Plan[] = [];
  const order = edits
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.paraId - b.e.paraId || a.e.span.start - b.e.span.start || a.e.span.end - b.e.span.end || a.i - b.i);
  for (const { e } of order) {
    const p = plan(xml, byId.get(e.paraId), e, mode);
    if (typeof p === 'string') unplaceable.push({ edit: e, reason: p });
    else if (plans.some((q) => q.edit.paraId === e.paraId && editsClash(q.edit.span, e.span))) {
      unplaceable.push({ edit: e, reason: 'overlaps another edit' });
    } else plans.push(p);
  }

  if (mode === 'tracked') {
    // A run that holds a text box contains the text box's runs: both cannot be rewritten. Keep the inner edits.
    for (;;) {
      const runs = [...new Map(plans.flatMap((p) => p.segs.map((s) => [s.pc.runStart, s.pc.runEnd] as const))).entries()].sort((a, b) => a[0] - b[0]);
      const outer = new Set<number>();
      for (let i = 0; i < runs.length; i++) {
        for (let j = i + 1; j < runs.length && runs[j][0] < runs[i][1]; j++) outer.add(runs[i][0]);
      }
      if (outer.size === 0) break;
      plans = plans.filter((p) => {
        if (!p.segs.some((s) => outer.has(s.pc.runStart))) return true;
        unplaceable.push({ edit: p.edit, reason: 'the run also holds a text box that is being edited' });
        return false;
      });
    }
  }

  if (plans.length === 0) return { xml, unplaceable };
  const splices = mode === 'tracked' ? trackedSplices(xml, plans, maxId(xml) + 1, isoSeconds(now)) : cleanSplices(xml, plans);
  const out = applySplices(xml, splices);

  // Self-check: the visible text must be exactly the original with the placed edits applied.
  const after = extractDocx(out, 0);
  if (after.length !== paras.length) throw new Error('internal: paragraph count changed while saving; refusing to write');
  for (const d of paras) {
    let text = d.para.text;
    const mine = plans.filter((p) => p.edit.paraId === d.para.id).sort((a, b) => b.edit.span.start - a.edit.span.start || b.edit.span.end - a.edit.span.end);
    for (const p of mine) text = text.slice(0, p.edit.span.start) + p.edit.replacement + text.slice(p.edit.span.end);
    if (after[d.para.id].para.text !== text) {
      throw new Error(`internal: paragraph ${d.para.id + 1} would not read back as expected; refusing to write`);
    }
  }
  return { xml: out, unplaceable };
}
