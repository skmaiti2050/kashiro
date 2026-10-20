#!/usr/bin/env python3
"""Generate the trust-suite corpus for writing-check.

Ported from the turnitout-audit kit (make_corpus.py). Each file makes one or more
release gates measurable:

  prose.txt        Academic prose full of exact facts (numbers, dates, names after
                   titles, units, citations) plus planted errors the app should fix
                   -> "facts survive", "no edit inside a fact-locked span".
  prose_zw.txt     The same prose with zero-width characters planted at known
                   offsets -> "invisible characters removed, none added".
  prose.md         Markdown with inline code, $math$, $$display math$$ and fenced
                   Python/JavaScript blocks (blank lines inside) -> "code untouched".
  paper.md         LaTeX-flavoured Markdown: \\cite, \\ref, inline/display math and a
                   fenced copy of a LaTeX document -> "LaTeX untouched".
  paper.txt        Plain text with inline LaTeX/code spans -> same gate for .txt.
  report.docx      Word file with a header, table, bold/italic runs, a custom style,
                   core/custom metadata and planted errors -> "skeleton identical
                   apart from tracked changes and edited runs", "other parts intact".

The app refuses .tex/.py/.js, so LaTeX and code are tested as spans inside .md/.txt
(spec section 9). Stdlib only and deterministic: re-running produces identical bytes.
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent / "corpus"

# Planted errors (fixable): "teh", "a experiment", "the the", a double space,
# "recieved" (several suggestions: accept-all must leave it), "there own".
PROSE = """\
The rapid adoption of large language models has changed teh way students write. In this paper, we examine the role that automated feedback plays in undergraduate engineering courses, and we report a experiment run over two semesters.

Between 14 March 2024 and 2 September 2025, we surveyed 1,284 students across 7 universities in Pune, Bengaluru and Goa. Participants submitted 3,912 essays with a mean length of 1,476 words (SD = 312). Essays revised with automated feedback scored 18.6% higher on the rubric than the the control group (p < 0.001, Cohen's d = 0.42), as reported by Sharma et al. [3].

Moreover, the treatment group needed 2.5 hours less revision time per assignment, while the per-student cost remained under INR 450 (USD 5.40).  Dr. Anjali Rao of IIT Bombay noted that the effect persisted for at least 6 months after the intervention ended, and Prof. Vikram Mehta recieved similar results in Goa.

In conclusion, these results show what automated feedback can do. However, students must continue to develop there own critical voice, as Mr. Rohan Desai argued at the 12th workshop on 5 October 2025.
"""

# Facts the analyzer requires to survive verbatim in every output that contained them.
FACTS = [
    "14 March 2024", "2 September 2025", "1,284", "7 universities", "Pune", "Bengaluru", "Goa",
    "3,912", "1,476", "SD = 312", "18.6%", "p < 0.001", "d = 0.42", "Sharma et al.", "[3]",
    "2.5 hours", "INR 450", "USD 5.40", "Anjali Rao", "IIT Bombay", "6 months",
    "Dr. Anjali Rao", "Prof. Vikram Mehta", "Mr. Rohan Desai", "12th", "5 October 2025",
    "Cohen's d",
]

ZERO_WIDTH = ["​", "‌", "‍", "⁠", "﻿", "­"]  # ZWSP, ZWNJ, ZWJ, WJ, BOM, soft hyphen

LATEX = r"""\documentclass{article}
\usepackage{amsmath}
\begin{document}
\section{Results}\label{sec:results}
Automated feedback plays a large role in revision quality \cite{sharma2024,rao2025}.
As shown in Table~\ref{tab:main} and Equation~\eqref{eq:gain}, the effect is large.
\begin{equation}\label{eq:gain}
  G = \frac{\mu_{t} - \mu_{c}}{\sigma_{pooled}} = 0.42, \quad p < 0.001
\end{equation}
Inline math such as $\alpha = 0.05$ and $n = 1{,}284$ must not change.
\begin{table}[h]
\centering
\begin{tabular}{lrr}
Group & Mean & SD \\
\hline
Treatment & 1476 & 312 \\
Control & 1244 & 298 \\
\end{tabular}
\caption{Essay length by group.}\label{tab:main}
\end{table}
\begin{verbatim}
print("do not touch this sentance, it is verbatim")
\end{verbatim}
Teh results are discussed in Section~\ref{sec:results}.
\end{document}
"""

PYTHON = '''\
"""Utility helpers for parsing invoice records.

This module provides a small set of functions that walk teh structure of each record.
"""
import re

# The regex below captures the invoice number, e.g. INV-2024-0042.
INVOICE_RE = re.compile(r"INV-(\\d{4})-(\\d{4})  # not a comment")
HASH_IN_STRING = "#this-is-data-not-a-comment"
TRIPLE = "\'\'\' still just a string \'\'\'"


def parse(line: str) -> dict:
    """Parse a single CSV line and return a a dictionary of fields."""
    # Split on commas; quoted commas are not supported here.
    parts = line.split(",")
    url = "https://example.com/#anchor"  # keep the fragment
    return {"id": parts[0], "amount": float(parts[1]), "url": url, "tag": HASH_IN_STRING}


def total(lines: list[str]) -> float:
    # We skip blank lines; its fine.
    return sum(parse(l)["amount"] for l in lines if l.strip())


if __name__ == "__main__":
    rows = ["INV-1,10.5", "INV-2,4.5", ""]
    assert total(rows) == 15.0
    print("OK")
'''

JAVASCRIPT = r"""// Utility helpers that format prices; teh output is fixed.
const URL = "https://example.com//path#frag"; // a string with // inside
const RE = /\/\/(\d+)/g; // regex containing slashes

/**
 * Format a number as INR. We round to 2 decimals.
 */
function formatInr(n) {
  /* a multi-line comment with a a doubled word */
  const s = `// template literal, not a comment ${n.toFixed(2)}`;
  return "INR " + n.toFixed(2) + (s.length > 0 ? "" : "!");
}

if (formatInr(5.4) !== "INR 5.40") throw new Error("broken");
console.log("OK");
"""

PROSE_MD = (
    "# Automated feedback: field notes\n\n"
    "We tracked teh results with a small script, `score_essays.py --min-words 300`, and stored them in "
    "`results/2025-09.csv`. The effect size was $d = 0.42$ and the threshold was $\\alpha = 0.05$, so the the "
    "result is significant for 1,284 students.\n\n"
    "$$\nG = \\frac{\\mu_{t} - \\mu_{c}}{\\sigma_{pooled}}\n$$\n\n"
    "Dr. Anjali Rao ran a analysis with the following code:\n\n"
    "```python\n" + PYTHON + "```\n\n"
    "The front end formats prices like this, and Prof. Vikram Mehta checked that it's  output is stable:\n\n"
    "```js\n" + JAVASCRIPT + "```\n\n"
    "As shown by Sharma et al. [3], the gain held for 6 months and cost under INR 450 per student.\n"
)

PAPER_MD = (
    "## Results\n\n"
    "Automated feedback improves revision quality \\cite{sharma2024,rao2025}. As shown in Table~\\ref{tab:main} "
    "and Equation~\\eqref{eq:gain}, teh effect is large (p < 0.001).\n\n"
    "$$\nG = \\frac{\\mu_{t} - \\mu_{c}}{\\sigma_{pooled}} = 0.42, \\quad p < 0.001\n$$\n\n"
    "Inline math such as $\\alpha = 0.05$ and $n = 1{,}284$ must not change, but a error next to it should "
    "still be fixed, as Dr. Anjali Rao pointed out on 14 March 2024.\n\n"
    "The full LaTeX source is kept below for reference.\n\n"
    "```latex\n" + LATEX + "```\n"
)

PAPER_TXT = (
    "Automated feedback improves revision quality \\cite{sharma2024,rao2025}, and teh gain is $G = 0.42$.\n\n"
    "We ran `python score.py --strict` on 3,912 essays; the the threshold was $\\alpha = 0.05$ and the "
    "macro \\textbf{bold claim} stays as written.\n\n"
    "Prof. Vikram Mehta reviewed a early draft in Pune on 2 September 2025.\n"
)

DOCX_PARAS = [
    ("Heading1", "Automated Feedback in Engineering Courses"),
    (None, "In this paper, we examine teh role that automated feedback plays. We surveyed 1,284 students across 7 universities."),
    (None, "Essays revised with feedback scored 18.6% higher (p < 0.001), as reported by Sharma et al. [3]."),
    (None, "Dr. Anjali Rao of IIT Bombay ran a experiment in Pune​ and the the results held for 6 months."),
]


def _docx_bytes() -> dict[str, str]:
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    paras = []
    for style, raw in DOCX_PARAS:
        text = escape(raw)  # "p < 0.001" must be &lt; inside XML, or Word parsers reject the part
        ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
        if style is None and "18.6%" in text:
            # Mixed formatting in one paragraph: bold number, italic citation.
            before, rest = text.split("18.6%", 1)
            mid, cite = rest.split("Sharma et al.", 1)
            runs = (f'<w:r><w:t xml:space="preserve">{before}</w:t></w:r>'
                    f'<w:r><w:rPr><w:b/></w:rPr><w:t>18.6%</w:t></w:r>'
                    f'<w:r><w:t xml:space="preserve">{mid}</w:t></w:r>'
                    f'<w:r><w:rPr><w:i/></w:rPr><w:t>Sharma et al.</w:t></w:r>'
                    f'<w:r><w:t xml:space="preserve">{cite}</w:t></w:r>')
        elif style is None and "teh role" in text:
            # The planted typo sits in an italic run between two plain runs.
            before, after = text.split("teh role", 1)
            runs = (f'<w:r><w:t xml:space="preserve">{before}</w:t></w:r>'
                    f'<w:r><w:rPr><w:i/></w:rPr><w:t>teh role</w:t></w:r>'
                    f'<w:r><w:t xml:space="preserve">{after}</w:t></w:r>')
        else:
            runs = f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'
        paras.append(f"<w:p>{ppr}{runs}</w:p>")
    cell = lambda t: f'<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>{t}</w:t></w:r></w:p></w:tc>'
    table = ('<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
             '<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>'
             f'<w:tr>{cell("Group")}{cell("Mean")}{cell("SD")}</w:tr>'
             f'<w:tr>{cell("Treatment")}{cell("1476")}{cell("312")}</w:tr></w:tbl>')
    sect = '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>'
    document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {ns}><w:body>{"".join(paras)}{table}{sect}</w:body></w:document>'
    header = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr {ns}><w:p><w:r><w:t>CONFIDENTIAL DRAFT - header must survive</w:t></w:r></w:p></w:hdr>'
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
              '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>'
              '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>')
    core = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            '<dc:title>Audit sample</dc:title><dc:creator>AUDIT-CANARY-AUTHOR</dc:creator>'
            '<cp:lastModifiedBy>AUDIT-CANARY-EDITOR</cp:lastModifiedBy>'
            '<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created></cp:coreProperties>')
    custom = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
              'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
              '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Reviewer"><vt:lpwstr>AUDIT-CANARY-PROPERTY</vt:lpwstr></property>'
              '</Properties>')
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                     '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
                     '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
                     '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>'
                     '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>'
            '</Relationships>')
    doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
                '</Relationships>')
    return {
        "[Content_Types].xml": content_types, "_rels/.rels": rels, "word/_rels/document.xml.rels": doc_rels,
        "word/document.xml": document, "word/styles.xml": styles, "word/header1.xml": header,
        "docProps/core.xml": core, "docProps/custom.xml": custom,
    }


def plant_zero_width(text: str) -> str:
    """Insert each zero-width character after every 40th character, cycling through the set."""
    out, k = [], 0
    for i, ch in enumerate(text, 1):
        out.append(ch)
        if i % 40 == 0 and ch != "\n":
            out.append(ZERO_WIDTH[k % len(ZERO_WIDTH)])
            k += 1
    return "".join(out)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    texts = {
        "prose.txt": PROSE,
        "prose_zw.txt": plant_zero_width(PROSE),
        "prose.md": PROSE_MD,
        "paper.md": PAPER_MD,
        "paper.txt": PAPER_TXT,
    }
    for name, text in texts.items():
        (OUT / name).write_text(text, encoding="utf-8", newline="\n")
    with zipfile.ZipFile(OUT / "report.docx", "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in _docx_bytes().items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))  # fixed timestamp keeps bytes stable
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    for p in sorted(OUT.iterdir()):
        print(f"{p.name:<14} {p.stat().st_size:>6} bytes")


if __name__ == "__main__":
    main()
