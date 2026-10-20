/**
 * Builds the reference documents of the trust suite (spec section 10) from marked-up sources.
 *
 *   trust/reference/src/<preset>/<slug>.<md|docx>.txt   ->   trust/reference/<preset>/<slug>.<md|docx>
 *
 * Source markup (removed in the output):
 *   {{wrong|right|s}}  a planted safe error (typo, doubled word, a/an, spacing): `wrong` is written
 *   {{wrong|right|j}}  a planted judgment error (agreement, its/it's, word choice)
 *   [[fact]]           a fact that must survive verbatim (names after titles, ₹ amounts, dates, citations)
 * .docx sources also understand: "# " / "## " headings, "- " bullets, **bold**, *italic*, and a table
 * written as consecutive "| a | b |" lines (the first row is the header; "|---|" lines are skipped).
 *
 * Also writes trust/reference/manifest.json (read by run_trust.ts, analyze.py and tests/decisions.test.ts)
 * and trust/reference/README.md. Output is deterministic (fixed zip timestamps).
 *
 *   npm run trust:reference
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { documentXml } from '../tests/fixtures/make_docx';
import { adapterFor } from '../src/formats/registry';
import { countWords } from './words';

const TRUST = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(TRUST, 'reference');
const SRC = path.join(REF, 'src');
const PRESETS = ['academic', 'blog', 'script', 'business'];

export interface ManifestDoc {
  file: string;
  preset: string;
  format: 'md' | 'docx';
  words: number;
  errors: { safe: number; judgment: number };
  /** wrong → right, in document order. */
  answers: { wrong: string; right: string; type: 's' | 'j' }[];
  facts: string[];
}

function render(src: string): { text: string; answers: ManifestDoc['answers']; facts: string[] } {
  const answers: ManifestDoc['answers'] = [];
  const facts: string[] = [];
  const text = src
    .replace(/\{\{([^|{}]*)\|([^|{}]*)\|([sj])\}\}/g, (_m, wrong: string, right: string, type: 's' | 'j') => {
      if (wrong === right) throw new Error(`no-op error marker: ${wrong}`);
      answers.push({ wrong, right, type });
      return wrong;
    })
    .replace(/\[\[([^\]]+)\]\]/g, (_m, fact: string) => {
      if (!facts.includes(fact)) facts.push(fact);
      return fact;
    });
  if (/\{\{|\}\}|\[\[|\]\]/.test(text)) throw new Error(`unbalanced marker near: ${text.match(/.{0,40}(\{\{|\}\}|\[\[|\]\]).{0,40}/)![0]}`);
  return { text, answers, facts };
}

// ---------- docx ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function runs(line: string): string {
  return line
    .split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/)
    .filter((part) => part.length > 0)
    .map((part) => {
      let rPr = '';
      let t = part;
      if (part.startsWith('**')) {
        rPr = '<w:rPr><w:b/></w:rPr>';
        t = part.slice(2, -2);
      } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        rPr = '<w:rPr><w:i/></w:rPr>';
        t = part.slice(1, -1);
      }
      return `<w:r>${rPr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
    })
    .join('');
}

const para = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs(text)}</w:p>`;

function table(rows: string[]): string {
  const cells = rows
    .filter((r) => !/^\|\s*-/.test(r))
    .map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const cols = cells[0].length;
  const w = Math.floor(9000 / cols);
  const tc = (t: string, head: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${para(head ? `**${t}**` : t)}</w:tc>`;
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
    `<w:tblGrid>${`<w:gridCol w:w="${w}"/>`.repeat(cols)}</w:tblGrid>` +
    cells.map((row, i) => `<w:tr>${row.map((c) => tc(c, i === 0)).join('')}</w:tr>`).join('') +
    `</w:tbl>`
  );
}

function docxBody(text: string): string {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines[0].startsWith('|')) out.push(table(lines));
    else if (lines.every((l) => l.startsWith('- '))) lines.forEach((l) => out.push(para(l.slice(2), 'ListBullet')));
    else if (lines[0].startsWith('## ')) out.push(para(lines.join(' ').slice(3), 'Heading2'));
    else if (lines[0].startsWith('# ')) out.push(para(lines.join(' ').slice(2), 'Heading1'));
    else out.push(para(lines.join(' ')));
  }
  out.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>');
  return out.join('');
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

async function buildDocx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  const date = new Date(Date.UTC(2026, 0, 1));
  const add = (name: string, data: string) => zip.file(name, data, { date, createFolders: false });
  add('[Content_Types].xml', CONTENT_TYPES);
  add('_rels/.rels', RELS);
  add('word/_rels/document.xml.rels', DOC_RELS);
  add('word/document.xml', documentXml(docxBody(text)));
  add('word/styles.xml', STYLES);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ---------- main ----------

async function main(): Promise<void> {
  const docs: ManifestDoc[] = [];
  for (const preset of PRESETS) {
    const dir = path.join(SRC, preset);
    if (!fs.existsSync(dir)) continue;
    fs.mkdirSync(path.join(REF, preset), { recursive: true });
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.txt')).sort()) {
      const out = name.slice(0, -'.txt'.length);
      const format = out.endsWith('.docx') ? 'docx' : 'md';
      const { text, answers, facts } = render(fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n'));
      const bytes = format === 'docx' ? await buildDocx(text) : new TextEncoder().encode(text);
      const file = `${preset}/${out}`;
      fs.writeFileSync(path.join(REF, file), bytes);
      const { paras } = await adapterFor(out)!.read(bytes);
      const all = paras.map((p) => p.text).join('\n');
      const lost = facts.filter((f) => !all.includes(f));
      if (lost.length) throw new Error(`${file}: facts not in extracted text: ${lost.join(', ')}`);
      docs.push({
        file,
        preset,
        format,
        words: countWords(paras),
        errors: { safe: answers.filter((a) => a.type === 's').length, judgment: answers.filter((a) => a.type === 'j').length },
        answers,
        facts,
      });
    }
  }
  fs.writeFileSync(path.join(REF, 'manifest.json'), JSON.stringify({ docs }, null, 2) + '\n');

  const rows = docs.map((d) => {
    const n = d.errors.safe + d.errors.judgment;
    return `| \`${d.file}\` | ${d.format} | ${d.words} | ${n} (${d.errors.safe} safe, ${d.errors.judgment} judgment) | ${(n * 100 / d.words).toFixed(2)} | ${d.facts.length} |`;
  });
  const readme = `# Reference documents

Twenty realistic documents, five per writing-goal preset, used by \`tests/decisions.test.ts\` (review budget:
at most 10 decisions per 1,500 words, spec section 10) and by \`npm run trust\` (facts, invisible characters,
docx structure). Each has roughly one planted error per 100 words, mixing *safe* errors (typos, doubled words,
a/an, spacing) and *judgment* errors (agreement, its/it's, word choice), plus facts that must survive verbatim
(Indian names after titles, ₹ amounts, dates, citations).

Generated by \`npm run trust:reference\` from \`src/<preset>/<slug>.<md|docx>.txt\`, where
\`{{wrong|right|s}}\` / \`{{wrong|right|j}}\` mark planted errors and \`[[fact]]\` marks facts.
\`manifest.json\` holds the answer key and facts. Do not edit the generated files by hand.

| Document | Format | Words | Planted errors | Errors per 100 words | Facts |
|---|---|---|---|---|---|
${rows.join('\n')}
`;
  fs.writeFileSync(path.join(REF, 'README.md'), readme);
  for (const d of docs) console.log(`${d.file.padEnd(48)} ${String(d.words).padStart(5)} words  ${d.errors.safe}s/${d.errors.judgment}j  ${d.facts.length} facts`);
}

await main();
