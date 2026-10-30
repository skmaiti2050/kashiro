import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import { extractDocx } from '@/formats/docx/extract';
import { splitRawText } from '@/formats/docx/tokenize';
import { createDocxAdapter, docxAdapter } from '@/formats/docx';
import { adapterFor } from '@/formats/registry';
import type { Edit } from '@/engine/session';
import type { SaveMode } from '@/formats/types';
import { buildDocx, documentXml } from '../../fixtures/make_docx';
import { acceptAllTexts, rejectAllTexts } from '../../fixtures/tracked_changes';

const NOW = new Date('2026-10-20T12:00:00.123Z');
const DATE = '2026-10-20T12:00:00Z';
const adapter = createDocxAdapter({ now: () => NOW });

const p = (inner: string) => `<w:p>${inner}</w:p>`;
const r = (inner: string, rPr = '') => `<w:r>${rPr}${inner}</w:r>`;
const t = (s: string) => `<w:t xml:space="preserve">${s}</w:t>`;
const B = '<w:rPr><w:b/></w:rPr>';
const REV = `w:author="Kashiro" w:date="${DATE}"`;

async function docXml(bytes: Uint8Array): Promise<string> {
  return (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
}

/** Apply edits to plain paragraph text (what session.outputText does). */
function applyText(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const { span, replacement } = sorted[i];
    text = text.slice(0, span.start) + replacement + text.slice(span.end);
  }
  return text;
}

/**
 * Write `edits` into a docx with `body`, then check the invariants every write must satisfy: well-formed
 * XML, and the re-extracted visible text equals the original text with exactly the placed edits applied.
 */
async function write(body: string, edits: Edit[], mode: SaveMode) {
  const bytes = await buildDocx(body);
  const { paras, handle } = await adapter.read(bytes);
  const res = await adapter.write(handle, edits, mode);
  const xml = await docXml(res.bytes);
  expect(XMLValidator.validate(xml)).toBe(true);
  const placed = edits.filter((e) => !res.unplaceable.some((u) => u.edit === e));
  const after = extractDocx(xml, 0).map((d) => d.para.text);
  expect(after).toEqual(paras.map((pa) => applyText(pa.text, placed.filter((e) => e.paraId === pa.id))));
  return { xml, original: documentXml(body), paras, unplaceable: res.unplaceable, texts: after };
}

const edit = (paraId: number, start: number, end: number, replacement: string): Edit => ({
  paraId,
  span: { start, end },
  replacement,
});

const ids = (xml: string) => [...xml.matchAll(/\bw:id="(-?\d+)"/g)].map((m) => Number(m[1]));

describe('splitRawText (decoded -> raw offsets)', () => {
  it('maps through entities', () => {
    expect(splitRawText('a &amp; teh', [4, 7])).toEqual(['a &amp; ', 'teh', '']);
    expect(splitRawText('&lt;x&gt;', [1, 2])).toEqual(['&lt;', 'x', '&gt;']);
    expect(splitRawText('abc', [0, 0])).toEqual(['', '', 'abc']);
  });

  it('closes and reopens CDATA at an interior cut', () => {
    expect(splitRawText('a<![CDATA[b<c]]>d', [2, 3])).toEqual(['a<![CDATA[b]]>', '<![CDATA[<]]>', '<![CDATA[c]]>d']);
    expect(splitRawText('a<![CDATA[bc]]>d', [3])).toEqual(['a<![CDATA[bc]]>', 'd']);
  });

  it('refuses to cut inside an astral character reference', () => {
    expect(() => splitRawText('&#x1F600;', [1])).toThrow();
    expect(splitRawText('&#x1F600;x', [2])).toEqual(['&#x1F600;', 'x']);
  });
});

describe('docx writer: tracked', () => {
  it('teh -> the inside a bold run: prefix, del, ins, suffix with the same rPr', async () => {
    const { xml, unplaceable, texts } = await write(p(r('<w:t>I saw teh cat</w:t>', B)), [edit(0, 6, 9, 'the')], 'tracked');
    expect(unplaceable).toEqual([]);
    expect(texts).toEqual(['I saw the cat']);
    expect(xml).toContain(
      `<w:r>${B}<w:t xml:space="preserve">I saw </w:t></w:r>` +
        `<w:del w:id="1" ${REV}><w:r>${B}<w:delText xml:space="preserve">teh</w:delText></w:r></w:del>` +
        `<w:ins w:id="2" ${REV}><w:r>${B}<w:t xml:space="preserve">the</w:t></w:r></w:ins>` +
        `<w:r>${B}<w:t xml:space="preserve"> cat</w:t></w:r>`,
    );
  });

  it('keeps the original run start-tag attributes on every split run', async () => {
    const { xml } = await write(p('<w:r w:rsidR="00AB12">' + B + '<w:t>a teh b</w:t></w:r>'), [edit(0, 2, 5, 'the')], 'tracked');
    expect(xml.match(/<w:r w:rsidR="00AB12">/g)).toHaveLength(4);
  });

  it('new w:id values are unique and above every existing w:id', async () => {
    const body =
      p('<w:bookmarkStart w:id="7" w:name="x"/>' + r(t('teh one ')) + '<w:bookmarkEnd w:id="7"/>') +
      p(r(t('kept ')) + `<w:ins w:id="12" w:author="Ann" w:date="2020-01-01T00:00:00Z">${r(t('old'))}</w:ins>` + r(t(' adn more')));
    const { xml, unplaceable } = await write(body, [edit(0, 0, 3, 'the'), edit(1, 9, 12, 'and')], 'tracked');
    expect(unplaceable).toEqual([]);
    const fresh = [...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)" w:author="Kashiro"/g)].map((m) => Number(m[1]));
    expect(fresh).toHaveLength(4);
    for (const id of fresh) expect(id).toBeGreaterThan(12);
    const revIds = [...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(revIds).size).toBe(revIds.length);
    expect(ids(xml).filter((i) => i === 7)).toHaveLength(2); // bookmark pair untouched
  });

  it('an edit across a bold+plain boundary deletes both segments; the insertion uses the first rPr', async () => {
    const { xml, texts } = await write(p(r('<w:t>Th</w:t>', B) + r(t('e cat'))), [edit(0, 0, 3, 'A')], 'tracked');
    expect(texts).toEqual(['A cat']);
    expect(xml).toContain(
      `<w:del w:id="1" ${REV}><w:r>${B}<w:delText xml:space="preserve">Th</w:delText></w:r></w:del>` +
        `<w:del w:id="2" ${REV}><w:r><w:delText xml:space="preserve">e</w:delText></w:r></w:del>` +
        `<w:ins w:id="3" ${REV}><w:r>${B}<w:t xml:space="preserve">A</w:t></w:r></w:ins>` +
        `<w:r><w:t xml:space="preserve"> cat</w:t></w:r>`,
    );
  });

  it('allows proofErr and bookmarks between the runs of a multi-run edit and keeps them', async () => {
    const body = p(r(t('a te')) + '<w:proofErr w:type="spellStart"/>' + r(t('h b')));
    const { xml, unplaceable } = await write(body, [edit(0, 2, 5, 'the')], 'tracked');
    expect(unplaceable).toEqual([]);
    expect(xml).toContain('<w:proofErr w:type="spellStart"/>');
  });

  it('a deletion (empty replacement) adds no w:ins', async () => {
    const { xml } = await write(p(r(t('the the cat'))), [edit(0, 3, 7, '')], 'tracked');
    expect(xml).toContain('<w:delText xml:space="preserve"> the</w:delText>');
    expect(xml).not.toContain('<w:ins');
  });

  it('a pure insertion at a run boundary uses the preceding run rPr', async () => {
    const { xml, texts } = await write(p(r('<w:t>bold</w:t>', B) + r(t(' plain'))), [edit(0, 4, 4, 'er')], 'tracked');
    expect(texts).toEqual(['bolder plain']);
    expect(xml).toContain(`<w:ins w:id="1" ${REV}><w:r>${B}<w:t xml:space="preserve">er</w:t></w:r></w:ins>`);
    expect(xml).not.toContain('<w:del ');
  });

  it('several edits in one w:t', async () => {
    const { texts, unplaceable } = await write(p(r(t('teh cat adn teh dog'))), [edit(0, 0, 3, 'the'), edit(0, 8, 11, 'and'), edit(0, 12, 15, 'the')], 'tracked');
    expect(unplaceable).toEqual([]);
    expect(texts).toEqual(['the cat and the dog']);
  });

  it('keeps run siblings (tab, second w:t) in order when splitting', async () => {
    const body = p(r(t('x teh ') + '<w:tab/>' + '<w:t>y</w:t>', '<w:rPr><w:i/></w:rPr>'));
    const { xml, texts } = await write(body, [edit(0, 2, 5, 'the')], 'tracked');
    expect(texts).toEqual(['x the \ty']);
    expect(xml).toContain(`<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> </w:t><w:tab/><w:t>y</w:t></w:r>`);
  });

  it('maps edits through entities in raw w:t content', async () => {
    const { xml } = await write(p(r('<w:t>a &amp; teh</w:t>')), [edit(0, 4, 7, 'the')], 'tracked');
    expect(xml).toContain('<w:t xml:space="preserve">a &amp; </w:t>');
    expect(xml).toContain('<w:delText xml:space="preserve">teh</w:delText>');
  });

  it.each(['\uFFFE', '\uFFFF', '\u0001', '\uD800'])('a replacement holding a character Word cannot store (%j) is unplaceable, never written', async (bad) => {
    const { unplaceable } = await write(p(r(t('x teh y'))), [edit(0, 2, 5, `t${bad}he`)], 'tracked');
    expect(unplaceable.map((u) => u.reason)).toEqual(['the replacement contains a character that cannot be saved in a Word document']);
  });

  it('escapes the replacement and preserves leading/trailing spaces', async () => {
    const { xml } = await write(p(r(t('x teh y'))), [edit(0, 2, 5, 'a < b & "c"'), edit(0, 7, 7, ' z ')], 'tracked');
    expect(xml).toContain('<w:t xml:space="preserve">a &lt; b &amp; "c"</w:t>');
    expect(xml).toContain('<w:t xml:space="preserve"> z </w:t>');
  });

  it('existing tracked changes survive verbatim', async () => {
    const ins = `<w:ins w:id="3" w:author="Ann" w:date="2020-01-01T00:00:00Z">${r(t('added'))}</w:ins>`;
    const del = `<w:del w:id="4" w:author="Ann" w:date="2020-01-01T00:00:00Z">${r('<w:delText>gone</w:delText>')}</w:del>`;
    const { xml, unplaceable } = await write(p(r(t('teh ')) + ins + del + r(t(' adn end'))), [edit(0, 0, 3, 'the'), edit(0, 10, 13, 'and')], 'tracked');
    expect(unplaceable).toEqual([]);
    expect(xml).toContain(ins + del);
  });

  it('edits inside a hyperlink stay inside it', async () => {
    const body = p(r(t('see ')) + `<w:hyperlink r:id="rId5">${r(t('teh site'))}</w:hyperlink>`);
    const { xml, unplaceable } = await write(body, [edit(0, 4, 7, 'the')], 'tracked');
    expect(unplaceable).toEqual([]);
    expect(xml).toMatch(/<w:hyperlink r:id="rId5"><w:del [^>]*>.*<\/w:ins><w:r><w:t xml:space="preserve"> site<\/w:t><\/w:r><\/w:hyperlink>/);
  });

  it('edits inside a text box are placed; an edit to the run holding that text box is unplaceable', async () => {
    const body = p(r(t('a teh ') + `<w:drawing><wps:txbx><w:txbxContent>${p(r(t('box teh')))}</w:txbxContent></wps:txbx></w:drawing>`) + r(t(' b')));
    const { unplaceable, texts } = await write(body, [edit(0, 2, 5, 'the'), edit(1, 4, 7, 'the')], 'tracked');
    expect(texts).toEqual(['a teh ￼ b', 'box the']);
    expect(unplaceable.map((u) => u.edit.paraId)).toEqual([0]);
    expect(unplaceable[0].reason).toMatch(/text box/);
  });

  it('a run with a tracked formatting change is unplaceable', async () => {
    const rPr = '<w:rPr><w:b/><w:rPrChange w:id="9" w:author="Ann" w:date="2020-01-01T00:00:00Z"><w:rPr/></w:rPrChange></w:rPr>';
    const { unplaceable, xml, original } = await write(p(r(t('teh'), rPr)), [edit(0, 0, 3, 'the')], 'tracked');
    expect(unplaceable).toHaveLength(1);
    expect(unplaceable[0].reason).toMatch(/tracked/);
    expect(xml).toBe(original);
  });
});

/** Kashiro's revisions in document order, as "del: x" / "ins: y". */
function revisions(xml: string): string[] {
  return [...xml.matchAll(/<w:(ins|del) w:id="\d+" w:author="Kashiro"[^>]*>.*?<w:(?:t|delText)[^>]*>(.*?)<\/w:(?:t|delText)>.*?<\/w:\1>/g)].map((m) => `${m[1]}: ${m[2]}`);
}

describe('docx writer: tracked changes show only the words that changed (Task F30)', () => {
  /** Write one tracked edit and check Accept All gives the clean text and Reject All gives the original. */
  async function tracked(body: string, e: Edit) {
    const res = await write(body, [e], 'tracked');
    expect(res.unplaceable).toEqual([]);
    expect(acceptAllTexts(res.xml)).toEqual(res.texts);
    expect(rejectAllTexts(res.xml)).toEqual(res.paras.map((pa) => pa.text));
    return res;
  }

  it('needs -> needs to: only " to" is inserted, nothing deleted', async () => {
    const { xml, texts } = await tracked(p(r(t('It needs fixing.'), B)), edit(0, 3, 8, 'needs to'));
    expect(texts).toEqual(['It needs to fixing.']);
    expect(revisions(xml)).toEqual(['ins:  to']);
    expect(xml).toContain(`<w:r>${B}<w:t xml:space="preserve">It needs</w:t></w:r><w:ins w:id="1" ${REV}><w:r>${B}<w:t xml:space="preserve"> to</w:t></w:r></w:ins>`);
  });

  it('the the -> the: the later " the" is deleted, the first word stays', async () => {
    const { xml } = await tracked(p(r(t('to the the market'))), edit(0, 3, 10, 'the'));
    expect(revisions(xml)).toEqual(['del:  the']);
    expect(xml).toContain('<w:t xml:space="preserve">to the</w:t>');
  });

  it('a apple -> an apple: "a" is replaced by "an", "apple" is untouched', async () => {
    const { xml } = await tracked(p(r(t('He ate a apple.'))), edit(0, 7, 14, 'an apple'));
    expect(revisions(xml)).toEqual(['del: a', 'ins: an']);
    expect(xml).toContain('<w:t xml:space="preserve"> apple.</w:t>');
  });

  it('recieve -> receive: the whole word is replaced, never letters inside it', async () => {
    const { xml } = await tracked(p(r(t('I recieve mail'))), edit(0, 2, 9, 'receive'));
    expect(revisions(xml)).toEqual(['del: recieve', 'ins: receive']);
  });

  it('issues . -> issues.: punctuation is a token, so only the space is deleted', async () => {
    const { xml } = await tracked(p(r(t('No issues .'))), edit(0, 3, 11, 'issues.'));
    expect(revisions(xml)).toEqual(['del:  ']);
  });

  it("an apostrophe inside a word keeps it one word: it's -> it is replaces the whole word", async () => {
    const { xml } = await tracked(p(r(t("it's fine"))), edit(0, 0, 4, 'it is'));
    expect(revisions(xml)).toEqual(["del: it's", 'ins: it is']);
  });

  it('a pure whitespace edit is written as today: the whole space run is replaced', async () => {
    const { xml } = await tracked(p(r(t('We went  home.'))), edit(0, 7, 9, ' '));
    expect(revisions(xml)).toEqual(['del:   ', 'ins:  ']);
  });

  it('a span across two runs with different formatting keeps each run\'s rPr on the unchanged words', async () => {
    const I = '<w:rPr><w:i/></w:rPr>';
    const { xml, texts } = await tracked(p(r(t('go to the '), B) + r(t('the shop'), I)), edit(0, 6, 13, 'the'));
    expect(texts).toEqual(['go to the shop']);
    expect(revisions(xml)).toEqual(['del:  ', 'del: the']);
    expect(xml).toContain(`<w:r>${B}<w:t xml:space="preserve">go to the</w:t></w:r><w:del w:id="1" ${REV}><w:r>${B}<w:delText xml:space="preserve"> </w:delText></w:r></w:del>`);
    expect(xml).toContain(`<w:del w:id="2" ${REV}><w:r>${I}<w:delText xml:space="preserve">the</w:delText></w:r></w:del><w:r>${I}<w:t xml:space="preserve"> shop</w:t></w:r>`);
  });

  it('a multi-run replacement: the shared word in the first run stays, the insertion takes the changed run\'s rPr', async () => {
    const I = '<w:rPr><w:i/></w:rPr>';
    const { xml } = await tracked(p(r(t('ate a '), B) + r(t('apple'), I)), edit(0, 4, 11, 'an apple'));
    expect(revisions(xml)).toEqual(['del: a', 'ins: an']);
    expect(xml).toContain(`<w:ins w:id="2" ${REV}><w:r>${B}<w:t xml:space="preserve">an</w:t></w:r></w:ins>`);
    expect(xml).toContain(`<w:r>${I}<w:t xml:space="preserve">apple</w:t></w:r>`);
  });

  it('an edit at the start of a paragraph', async () => {
    const { xml, texts } = await tracked(p(r(t('A apple fell.'))), edit(0, 0, 7, 'An apple'));
    expect(texts).toEqual(['An apple fell.']);
    expect(revisions(xml)).toEqual(['del: A', 'ins: An']);
  });

  it('an edit at the end of a paragraph', async () => {
    const { xml, texts } = await tracked(p(r(t('It is done done'))), edit(0, 6, 15, 'done'));
    expect(texts).toEqual(['It is done']);
    expect(revisions(xml)).toEqual(['del:  done']);
  });

  it('only words shared at the start and the end are kept: a change at both ends replaces the whole span', async () => {
    const { xml } = await tracked(p(r(t('needs work'))), edit(0, 0, 10, 'it needs work now'));
    expect(revisions(xml)).toEqual(['del: needs work', 'ins: it needs work now']);
  });

  it('clean mode is untouched: needs -> needs to rewrites the w:t in place', async () => {
    const { xml, original } = await write(p(r('<w:t>It needs fixing.</w:t>', B)), [edit(0, 3, 8, 'needs to')], 'clean');
    expect(xml).toBe(original.replace('<w:t>It needs fixing.</w:t>', '<w:t xml:space="preserve">It needs to fixing.</w:t>'));
  });
});

describe('docx writer: unplaceable', () => {
  const cases: [string, string, Edit, RegExp][] = [
    ['crossing into a hyperlink', p(r(t('see ')) + `<w:hyperlink r:id="rId5">${r(t('here'))}</w:hyperlink>`), edit(0, 2, 6, 'x'), /hyperlink/],
    ['overlapping a simple field', p(r(t('page ')) + `<w:fldSimple w:instr="PAGE">${r(t('3'))}</w:fldSimple>`), edit(0, 3, 6, 'x'), /field/],
    [
      'overlapping a complex field result',
      p(r(t('see ')) + r('<w:fldChar w:fldCharType="begin"/>') + r('<w:instrText>REF x</w:instrText>') + r('<w:fldChar w:fldCharType="separate"/>') + r(t('Table 1')) + r('<w:fldChar w:fldCharType="end"/>')),
      edit(0, 2, 6, 'x'),
      /field/,
    ],
    ['overlapping an existing insertion', p(r(t('ab ')) + `<w:ins w:id="1" w:author="A" w:date="2020-01-01T00:00:00Z">${r(t('cd'))}</w:ins>`), edit(0, 1, 4, 'x'), /tracked change/],
    ['crossing an existing deletion', p(r(t('ab')) + `<w:del w:id="1" w:author="A" w:date="2020-01-01T00:00:00Z">${r('<w:delText>X</w:delText>')}</w:del>` + r(t('cd'))), edit(0, 1, 3, 'x'), /tracked change/],
    ['crossing a tab', p(r(t('a') + '<w:tab/>' + t('b'))), edit(0, 0, 3, 'x'), /tab|break|object/],
    ['crossing hidden text', p(r(t('a ')) + r(t('secret'), '<w:rPr><w:vanish/></w:rPr>')), edit(0, 1, 4, 'x'), /hidden|locked/],
    ['a span out of range', p(r(t('abc'))), edit(0, 2, 9, 'x'), /not found|range/],
    ['an unknown paragraph', p(r(t('abc'))), edit(5, 0, 1, 'x'), /not found|paragraph/],
    ['a replacement with a line break', p(r(t('abc'))), edit(0, 0, 1, 'x\ny'), /line break|tab|character/],
  ];
  for (const [name, body, e, reason] of cases) {
    for (const mode of ['tracked', 'clean'] as const) {
      it(`${name} (${mode})`, async () => {
        const { xml, original, unplaceable } = await write(body, [e], mode);
        expect(unplaceable).toHaveLength(1);
        expect(unplaceable[0].edit).toBe(e);
        expect(unplaceable[0].reason).toMatch(reason);
        expect(xml).toBe(original);
      });
    }
  }

  it('an unplaceable edit leaves its region unchanged while others apply', async () => {
    const link = `<w:hyperlink r:id="rId5">${r(t('here'))}</w:hyperlink>`;
    const { xml, unplaceable, texts } = await write(p(r(t('teh see ')) + link), [edit(0, 0, 3, 'the'), edit(0, 6, 10, 'x')], 'tracked');
    expect(unplaceable.map((u) => u.edit.span.start)).toEqual([6]);
    expect(texts).toEqual(['the see here']);
    expect(xml).toContain(link);
  });

  it('overlapping edits: the later one is unplaceable', async () => {
    const { unplaceable } = await write(p(r(t('abcdef'))), [edit(0, 0, 3, 'x'), edit(0, 2, 4, 'y')], 'tracked');
    expect(unplaceable.map((u) => u.edit.span.start)).toEqual([2]);
  });
});

describe('docx writer: clean', () => {
  it('replaces text in place, formatting unchanged, no revisions', async () => {
    const { xml, original } = await write(p(r('<w:t>I saw teh cat</w:t>', B)), [edit(0, 6, 9, 'the')], 'clean');
    expect(xml).toBe(original.replace('<w:t>I saw teh cat</w:t>', '<w:t xml:space="preserve">I saw the cat</w:t>'));
    expect(xml).not.toMatch(/<w:(ins|del)\b/);
  });

  it('a multi-run edit writes into the first piece and removes the rest', async () => {
    const { xml } = await write(p(r('<w:t>Th</w:t>', B) + r(t('e cat'))), [edit(0, 0, 3, 'A')], 'clean');
    expect(xml).toContain(`<w:r>${B}<w:t xml:space="preserve">A</w:t></w:r><w:r><w:t xml:space="preserve"> cat</w:t></w:r>`);
  });

  it('escapes and preserves spaces', async () => {
    const { xml } = await write(p(r('<w:t>x</w:t>')), [edit(0, 1, 1, ' a < b & "c" ')], 'clean');
    expect(xml).toContain('<w:t xml:space="preserve">x a &lt; b &amp; "c" </w:t>');
  });

  it('keeps entities outside the edit and edits inside a text box', async () => {
    const body = p(r('<w:t>a &amp; teh</w:t>') + r(`<w:drawing><wps:txbx><w:txbxContent>${p(r(t('box teh')))}</w:txbxContent></wps:txbx></w:drawing>`));
    const { xml, unplaceable } = await write(body, [edit(0, 4, 7, 'the'), edit(1, 4, 7, 'the')], 'clean');
    expect(unplaceable).toEqual([]);
    expect(xml).toContain('<w:t xml:space="preserve">a &amp; the</w:t>');
  });
});

describe('docx adapter: package', () => {
  it('only word/document.xml changes; other entries are byte-identical and in order', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('_rels/.rels', '<Relationships/>');
    zip.file('word/document.xml', documentXml(p(r(t('teh')))));
    zip.file('word/styles.xml', '<w:styles>déjà</w:styles>');
    zip.file('word/media/image1.png', new Uint8Array([137, 80, 78, 71, 0, 1, 2, 255]), { compression: 'STORE' });
    zip.file('word/header1.xml', '<w:hdr>teh</w:hdr>');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    for (const mode of ['tracked', 'clean'] as const) {
      const { handle } = await adapter.read(bytes);
      const res = await adapter.write(handle, [edit(0, 0, 3, 'the')], mode);
      const a = await JSZip.loadAsync(bytes);
      const b = await JSZip.loadAsync(res.bytes);
      expect(Object.keys(b.files)).toEqual(Object.keys(a.files));
      for (const name of Object.keys(a.files)) {
        if (name === 'word/document.xml' || a.files[name].dir) continue;
        expect(await b.file(name)!.async('uint8array')).toEqual(await a.file(name)!.async('uint8array'));
      }
      expect(extractDocx(await b.file('word/document.xml')!.async('string'), 0)[0].para.text).toBe('the');
    }
  });

  it('is registered for .docx and reads paragraphs with ids from 0', async () => {
    expect(adapterFor('Report.DOCX')).toBe(docxAdapter);
    expect(docxAdapter.language).toBe('plaintext');
    const { paras } = await docxAdapter.read(await buildDocx(p(r(t('one'))) + p(r(t('two')))));
    expect(paras).toEqual([
      { id: 0, text: 'one' },
      { id: 1, text: 'two' },
    ]);
  });

  it('writing twice from one handle gives the same result (handle not mutated)', async () => {
    const { handle } = await adapter.read(await buildDocx(p(r(t('teh')))));
    const a = await adapter.write(handle, [edit(0, 0, 3, 'the')], 'tracked');
    await adapter.write(handle, [edit(0, 0, 3, 'x')], 'clean');
    const c = await adapter.write(handle, [edit(0, 0, 3, 'the')], 'tracked');
    expect(await docXml(c.bytes)).toBe(await docXml(a.bytes));
  });
});
