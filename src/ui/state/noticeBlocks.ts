/**
 * The notice files (resources/*\/ATTRIBUTION.md) as readable blocks for About (Task U3 item 8): a tiny Markdown
 * subset, parsed into plain data that React renders as text. Nothing becomes HTML, so a notice can never inject
 * markup; a link shows as its text and address, never as something to click. Fenced blocks (the licence texts)
 * stay verbatim.
 */

export interface Inline {
  kind: 'text' | 'code' | 'strong';
  text: string;
}

export type Block =
  | { kind: 'heading'; level: number; text: Inline[] }
  | { kind: 'paragraph'; text: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string };

/** "```" or "```text": a fence line. */
const FENCE = /^```/;
/** "## Changes" → level 2, "Changes". */
const HEADING = /^(#{1,6})\s+(.*)$/;
/** "- item", "* item", "12. item" (with the indent a nested item may have). */
const LIST_ITEM = /^\s*(?:([-*])|\d+\.)\s+(.*)$/;
/** An indented line under a list item: it continues that item. */
const CONTINUATION = /^\s+\S/;
/** `code`, **bold** or [text](address), whichever comes first. */
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Inline code and bold become their own pieces; a link becomes "text (address)"; the rest is text. */
export function inlines(line: string): Inline[] {
  const out: Inline[] = [];
  const text = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += t;
    else out.push({ kind: 'text', text: t });
  };
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    text(line.slice(at, m.index));
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'strong', text: m[2] });
    else text(`${m[3]} (${m[4]})`);
    at = m.index! + m[0].length;
  }
  text(line.slice(at));
  return out;
}

export function markdownBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: inlines(paragraph.join(' ')) });
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(inlines) });
    paragraph = [];
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flush();
      const end = lines.findIndex((l, j) => j > i && FENCE.test(l));
      const stop = end === -1 ? lines.length : end;
      blocks.push({ kind: 'code', text: lines.slice(i + 1, stop).join('\n') });
      i = stop;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length, text: inlines(heading[2].trim()) });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = item[1] === undefined;
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[2].trim());
      continue;
    }
    if (list && CONTINUATION.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
