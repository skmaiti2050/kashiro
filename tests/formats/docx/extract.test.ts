import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractDocx, type DocxPara } from '@/formats/docx/extract';
import { tokenize, decodeXmlText } from '@/formats/docx/tokenize';
import { buildDocx, documentXml } from '../../fixtures/make_docx';

/** Offset invariants every extraction must satisfy; checked on every test's output. */
function checkInvariants(xml: string, out: DocxPara[]) {
  for (const { para, pieces } of out) {
    let expectOffset = 0;
    for (const pc of pieces) {
      expect(pc.paraOffset).toBe(expectOffset);
      expectOffset += pc.length;
      const raw = xml.slice(pc.xmlStart, pc.xmlEnd);
      if (pc.kind === 'text') {
        expect(decodeXmlText(raw)).toBe(para.text.slice(pc.paraOffset, pc.paraOffset + pc.length));
      } else {
        expect(pc.length).toBe(1);
        expect(raw.startsWith('<')).toBe(true);
        expect(raw.endsWith('>')).toBe(true);
      }
      expect(xml.slice(pc.runStart, pc.runStart + 5)).toMatch(/^<w:r[\s>/]/);
      expect(xml.slice(pc.runEnd - 6, pc.runEnd)).toMatch(/(<\/w:r>|\/>)$/);
      expect(pc.runStart <= pc.xmlStart && pc.xmlEnd <= pc.runEnd).toBe(true);
      if (pc.rPr) expect(xml.slice(pc.runStart, pc.runEnd)).toContain(pc.rPr);
    }
    expect(expectOffset).toBe(para.text.length);
  }
}

function ex(body: string, firstId = 0): DocxPara[] {
  const xml = documentXml(body);
  const out = extractDocx(xml, firstId);
  checkInvariants(xml, out);
  return out;
}
const texts = (out: DocxPara[]) => out.map((d) => d.para.text);
const p = (inner: string) => `<w:p>${inner}</w:p>`;
const r = (inner: string, rPr = '') => `<w:r>${rPr}${inner}</w:r>`;
const t = (s: string) => `<w:t xml:space="preserve">${s}</w:t>`;

describe('tokenize', () => {
  it('handles quoted >, self-closing tags, comments, PIs and CDATA', () => {
    const xml = `<?xml version="1.0"?><a x="1>2" y='>'><!-- <b> --><c/><![CDATA[<d>]]>t&amp;</a>`;
    const toks = [...tokenize(xml)];
    expect(toks.map((k) => k.kind)).toEqual(['pi', 'open', 'comment', 'open', 'cdata', 'text', 'close']);
    expect(toks[1]).toMatchObject({ name: 'a', selfClosing: false });
    expect(toks[3]).toMatchObject({ name: 'c', selfClosing: true });
    expect(xml.slice(toks[1].start, toks[1].end)).toBe(`<a x="1>2" y='>'>`);
  });

  it('decodes named, decimal, hex and astral references plus CDATA, skipping comments', () => {
    expect(decodeXmlText('&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&#x1F600;')).toBe('<>&"\'AB\u{1F600}');
    expect(decodeXmlText('a<![CDATA[<&amp;>]]>b<!-- x -->c')).toBe('a<&amp;>bc');
    expect(() => decodeXmlText('&nbsp;')).toThrow();
  });

  it('throws on mismatched tags', () => {
    expect(() => extractDocx('<w:p><w:r></w:p></w:r>', 0)).toThrow();
  });
});

describe('extractDocx', () => {
  it('decodes entities', () => {
    const out = ex(p(r('<w:t>p &lt; 0.001 &amp; more</w:t>')));
    expect(texts(out)).toEqual(['p < 0.001 & more']);
    expect(out[0].pieces[0]).toMatchObject({ length: 16, kind: 'text', container: 'plain' });
  });

  it('keeps preserved leading space', () => {
    expect(texts(ex(p(r('<w:t xml:space="preserve"> lead</w:t>'))))).toEqual([' lead']);
  });

  it('joins runs, recording run ranges and verbatim rPr', () => {
    const body = p(r(t('Hel'), '<w:rPr><w:b/></w:rPr>') + r(t('lo')));
    const xml = documentXml(body);
    const out = ex(body);
    expect(texts(out)).toEqual(['Hello']);
    const [a, b] = out[0].pieces;
    expect(out[0].pieces).toHaveLength(2);
    expect(a).toMatchObject({ paraOffset: 0, length: 3, rPr: '<w:rPr><w:b/></w:rPr>' });
    expect(b).toMatchObject({ paraOffset: 3, length: 2, rPr: '' });
    expect(xml.slice(a.runStart, a.runEnd)).toBe(r(t('Hel'), '<w:rPr><w:b/></w:rPr>'));
    expect(xml.slice(b.runStart, b.runEnd)).toBe(r(t('lo')));
    expect(xml.slice(a.xmlStart, a.xmlEnd)).toBe('Hel');
  });

  it('makes each table cell paragraph its own Paragraph, ids from firstId', () => {
    const cell = (s: string) => `<w:tc><w:tcPr/>${p(r(t(s)))}</w:tc>`;
    const out = ex(p(r(t('before'))) + `<w:tbl><w:tr>${cell('A')}${cell('B')}</w:tr></w:tbl>` + '<w:p/>', 10);
    expect(texts(out)).toEqual(['before', 'A', 'B', '']);
    expect(out.map((d) => d.para.id)).toEqual([10, 11, 12, 13]);
  });

  it('turns specials into locked length-1 pieces; pPr tabs are ignored', () => {
    const body = p(
      '<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' +
        r(t('a') + '<w:tab/>' + t('b') + '<w:br/><w:cr/><w:sym w:font="Symbol" w:char="F0B7"/><w:noBreakHyphen/><w:softHyphen/>' + t('c')),
    );
    const out = ex(body);
    expect(texts(out)).toEqual(['a\tb\n\n￼￼￼c']);
    const specials = out[0].pieces.filter((x) => x.kind === 'special');
    expect(specials).toHaveLength(6);
    expect(out[0].para.locked).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 8 },
    ]);
  });

  it('special with open/close tags spans the whole element', () => {
    const body = p(r('<w:tab></w:tab>'));
    const xml = documentXml(body);
    const [pc] = ex(body)[0].pieces;
    expect(xml.slice(pc.xmlStart, pc.xmlEnd)).toBe('<w:tab></w:tab>');
  });

  it('excludes w:del and includes locked w:ins', () => {
    const body = p(
      r(t('keep ')) +
        `<w:del w:id="1" w:author="X"><w:r><w:delText>gone</w:delText></w:r></w:del>` +
        `<w:ins w:id="2" w:author="X"><w:r><w:t>new</w:t></w:r></w:ins>` +
        r(t(' end')),
    );
    const out = ex(body);
    expect(texts(out)).toEqual(['keep new end']);
    expect(out[0].para.locked).toEqual([{ start: 5, end: 8 }]);
    expect(out[0].pieces[1].container).toBe('ins');
  });

  it('excludes moveFrom, includes locked moveTo', () => {
    const out = ex(
      p(`<w:moveFrom w:id="1"><w:r><w:t>old</w:t></w:r></w:moveFrom>`) +
        p(`<w:moveTo w:id="2"><w:r><w:t>old</w:t></w:r></w:moveTo>`),
    );
    expect(texts(out)).toEqual(['', 'old']);
    expect(out[1].para.locked).toEqual([{ start: 0, end: 3 }]);
    expect(out[1].pieces[0].container).toBe('ins');
  });

  it('paragraph-mark ins/del markers in rPr do not affect text', () => {
    const out = ex(p(`<w:pPr><w:rPr><w:ins w:id="1" w:author="X"/><w:del w:id="2" w:author="X"/></w:rPr></w:pPr>` + r(t('x'))));
    expect(texts(out)).toEqual(['x']);
    expect(out[0].para.locked).toBeUndefined();
  });

  it('includes hyperlink text, container hyperlink, not locked', () => {
    const out = ex(p(r(t('see ')) + `<w:hyperlink r:id="rId5" w:history="1">${r(t('this link'))}</w:hyperlink>`));
    expect(texts(out)).toEqual(['see this link']);
    expect(out[0].pieces[1].container).toBe('hyperlink');
    expect(out[0].para.locked).toBeUndefined();
  });

  it('includes sdt/smartTag/customXml content as plain', () => {
    const out = ex(
      p(`<w:sdt><w:sdtPr/><w:sdtContent>${r(t('a'))}</w:sdtContent></w:sdt><w:smartTag w:uri="u" w:element="e">${r(t('b'))}</w:smartTag><w:customXml w:element="c">${r(t('c'))}</w:customXml>`),
    );
    expect(texts(out)).toEqual(['abc']);
    expect(out[0].pieces.map((x) => x.container)).toEqual(['plain', 'plain', 'plain']);
  });

  it('complex fields: instrText excluded, result included and locked, nested results too', () => {
    const fc = (type: string) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
    const body = p(
      r(t('Page ')) +
        fc('begin') + `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` + fc('separate') + r(t('3')) + fc('end') +
        r(t(', toc ')) +
        fc('begin') + `<w:r><w:instrText> TOC </w:instrText></w:r>` + fc('separate') +
        r(t('Intro ')) + fc('begin') + `<w:r><w:instrText> PAGEREF x </w:instrText></w:r>` + fc('separate') + r(t('1')) + fc('end') +
        fc('end') +
        r(t('.')),
    );
    const out = ex(body);
    expect(texts(out)).toEqual(['Page 3, toc Intro 1.']);
    expect(out[0].para.locked).toEqual([
      { start: 5, end: 6 },
      { start: 12, end: 19 },
    ]);
    expect(out[0].pieces.map((x) => x.container)).toEqual(['plain', 'field', 'plain', 'field', 'field', 'plain']);
  });

  it('field with a nested field in its instruction: only the outer result shows', () => {
    const fc = (type: string) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
    const body = p(
      fc('begin') + `<w:r><w:instrText>IF </w:instrText></w:r>` +
        fc('begin') + `<w:r><w:instrText>MERGEFIELD a</w:instrText></w:r>` + fc('separate') + r(t('inner')) + fc('end') +
        fc('separate') + r(t('outer')) + fc('end'),
    );
    expect(texts(ex(body))).toEqual(['outer']);
  });

  it('fields spanning paragraphs keep their state', () => {
    const fc = (type: string) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
    const out = ex(
      p(fc('begin') + `<w:r><w:instrText>TOC</w:instrText></w:r>` + fc('separate') + r(t('Entry one'))) + p(r(t('Entry two')) + fc('end')) + p(r(t('after'))),
    );
    expect(texts(out)).toEqual(['Entry one', 'Entry two', 'after']);
    expect(out[1].para.locked).toEqual([{ start: 0, end: 9 }]);
    expect(out[2].para.locked).toBeUndefined();
  });

  it('fldSimple content is included and locked as field', () => {
    const out = ex(p(r(t('n=')) + `<w:fldSimple w:instr=" SEQ Table "><w:r><w:t>4</w:t></w:r></w:fldSimple>`));
    expect(texts(out)).toEqual(['n=4']);
    expect(out[0].pieces[1].container).toBe('field');
    expect(out[0].para.locked).toEqual([{ start: 2, end: 3 }]);
  });

  it('text box paragraphs are separate; AlternateContent uses Choice and skips Fallback', () => {
    const box = (s: string) => `<w:txbxContent>${p(r(t(s)))}</w:txbxContent>`;
    const body = p(
      r(t('outer ')) +
        r(
          `<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx>${box('in box')}</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>` +
            `<mc:Fallback><w:pict><v:shape><v:textbox>${box('in box')}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent>`,
        ) +
        r(t('text')),
    ) + p(r(t('next')));
    const out = ex(body, 1);
    expect(out.map((d) => [d.para.id, d.para.text])).toEqual([
      [1, 'outer text'],
      [2, 'in box'],
      [3, 'next'],
    ]);
  });

  it('runs with no text contribute nothing; self-closing w:t and empty w:t give no piece', () => {
    const out = ex(p(r('<w:footnoteReference w:id="1"/>') + r('<w:t/>') + r('<w:t></w:t>') + r('<w:drawing/>') + r(t('x'))));
    expect(texts(out)).toEqual(['x']);
    expect(out[0].pieces).toHaveLength(1);
  });

  it('CDATA and comments inside w:t keep offsets right', () => {
    const body = p(r('<w:t>a<![CDATA[<b>&amp;]]><!-- c -->d</w:t>') + r(t('e')));
    const out = ex(body);
    expect(texts(out)).toEqual(['a<b>&amp;de']);
    expect(out[0].pieces[1].paraOffset).toBe(10);
  });

  it('attributes with > in quotes do not break offsets', () => {
    const body = p(`<w:r w:rsidR="a>b"><w:rPr><w:rFonts w:ascii='x>y'/></w:rPr><w:t foo="1>2">ok &gt; go</w:t></w:r>`);
    const out = ex(body);
    expect(texts(out)).toEqual(['ok > go']);
    expect(out[0].pieces[0].rPr).toBe(`<w:rPr><w:rFonts w:ascii='x>y'/></w:rPr>`);
  });

  it('emoji, Bengali and numeric astral refs keep UTF-16 lengths', () => {
    const out = ex(p(r(t('hi 😀 বাংলা ')) + r(t('&#x1F44D;&#2453;'))));
    const want = 'hi 😀 বাংলা 👍ক';
    expect(texts(out)).toEqual([want]);
    expect(out[0].pieces[0].length).toBe('hi 😀 বাংলা '.length);
    expect(out[0].pieces[1]).toMatchObject({ paraOffset: 'hi 😀 বাংলা '.length, length: 3 });
  });

  it('reads document.xml out of a built .docx', async () => {
    const bytes = await buildDocx(p(r(t('zip &amp; back'))));
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    const out = extractDocx(xml, 0);
    checkInvariants(xml, out);
    expect(texts(out)).toEqual(['zip & back']);
  });
});
