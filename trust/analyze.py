#!/usr/bin/env python3
"""Release gates for writing-check, scored from input/output pairs.

Ported from the turnitout-audit kit (analyze.py). The kit's claims become pass/fail
gates for this app, and the humanizer-only claims (signature phrases, similarity
fingerprints, SynthID, metadata stripping, determinism-as-a-claim, Crossref
reference lookups) are dropped. This script makes no network calls.

Gates, for every input that has an output:
  facts        every planted fact present in the input is present verbatim in the output
  invisible    no zero-width/invisible character left in Latin context, and none added
  spans        LaTeX and code spans (fenced/inline code, $math$, $$math$$, \\commands)
               byte-identical, in order
  docx         word/document.xml skeleton identical apart from w:ins/w:del and edited
               runs; every other package part byte-identical (header, styles, metadata)

Inputs come from two roots, mirrored under --outputs:
  trust/corpus/<name>            (from make_corpus.py; facts = make_corpus.FACTS)
  trust/reference/<preset>/<doc> (listed in trust/reference/manifest.json, with facts)

    python trust/analyze.py --outputs trust/out/tracked

Exit status 1 when any gate fails or an expected output is missing.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import zipfile
from pathlib import Path

from make_corpus import FACTS, ZERO_WIDTH

ROOT = Path(__file__).resolve().parent
CORPUS, REFERENCE = ROOT / "corpus", ROOT / "reference"
results: list[tuple[str, str, bool, str]] = []  # (file, gate, ok, evidence)
lines: list[str] = []


def say(s: str = "") -> None:
    lines.append(s)
    print(s)


def gate(name: str, gate_name: str, ok: bool, evidence: str) -> None:
    results.append((name, gate_name, ok, evidence))
    say(f"  [{'PASS' if ok else 'FAIL'}] {gate_name}: {evidence}")


# ---------- text gates ----------

def facts_gate(name: str, orig: str, out: str, facts: list[str]) -> None:
    present = [f for f in facts if f in orig]
    missing = [f for f in present if f not in out]
    gate(name, "facts", not missing,
         f"{len(present) - len(missing)}/{len(present)} preserved" + (f"; changed/missing: {missing}" if missing else ""))


# Scripts where ZWJ/ZWNJ/soft hyphen are legitimate (mirrors src/engine/hygiene.ts).
JOINER_SCRIPT = re.compile(
    "[\u0900-\u0DFF"  # Devanagari .. Sinhala
    "\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]"  # Arabic
)


def latin_context_invisibles(t: str) -> dict[str, int]:
    """Zero-width characters whose neighbours are not Indic/Arabic script (a leading file BOM is not counted)."""
    found: dict[str, int] = {}
    for i, ch in enumerate(t):
        if ch not in ZERO_WIDTH or (i == 0 and ch == "\ufeff"):
            continue
        prev, nxt = t[i - 1] if i else "", t[i + 1] if i + 1 < len(t) else ""
        if ch in "\u200c\u200d\u00ad" and (JOINER_SCRIPT.match(prev or " ") or JOINER_SCRIPT.match(nxt or " ")):
            continue
        key = f"U+{ord(ch):04X}"
        found[key] = found.get(key, 0) + 1
    return found


def invisible_gate(name: str, orig: str, out: str) -> None:
    left = latin_context_invisibles(out)
    added = {f"U+{ord(c):04X}": out.count(c) - orig.count(c) for c in ZERO_WIDTH if out.count(c) > orig.count(c)}
    planted = sum(orig.count(c) for c in ZERO_WIDTH)
    gate(name, "invisible", not left and not added,
         (f"{planted} in input, none left in Latin context" if not left else f"still present: {left}")
         + (f"; ADDED: {added}" if added else ""))


SPAN_PATTERNS = {
    "fenced code": re.compile(r"^```.*?^```", re.S | re.M),
    "display math": re.compile(r"\$\$.+?\$\$", re.S),
    "inline math": re.compile(r"(?<!\$)\$[^\s$](?:[^$\n]*[^\s$])?\$(?!\$)"),
    "inline code": re.compile(r"(?<!`)`[^`\n]+`(?!`)"),
    "latex command": re.compile(r"\\[A-Za-z]+\*?(?:\[[^\]\n]*\])*(?:\{[^{}\n]*\})*"),
}


def protected_spans(t: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    rest = t
    for kind, rx in SPAN_PATTERNS.items():
        out[kind] = rx.findall(rest)
        if kind == "fenced code":
            rest = rx.sub("\0", rest)  # spans inside a fence are covered by the fence itself
    return out


def spans_gate(name: str, orig: str, out: str) -> None:
    a, b = protected_spans(orig), protected_spans(out)
    total = sum(len(v) for v in a.values())
    if not total:
        return
    broken = [k for k in a if a[k] != b[k]]
    detail = ""
    for k in broken:
        diffs = [(x, y) for x, y in zip(a[k], b[k]) if x != y][:2]
        detail += f"; {k}: {len(a[k])} -> {len(b[k])} spans, first diffs {diffs}"
    gate(name, "spans", not broken, f"{total} LaTeX/code spans identical" if not broken else f"changed: {broken}{detail}")


def text_gates(name: str, orig: str, out: str, facts: list[str]) -> None:
    facts_gate(name, orig, out, facts)
    invisible_gate(name, orig, out)
    spans_gate(name, orig, out)


# ---------- DOCX ----------

def docx_parts(p: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(p) as z:
        return {n: z.read(n) for n in z.namelist() if not n.endswith("/")}  # directory entries are not parts


DEL = re.compile(r"<w:del\b[^>]*?(?:/>|>.*?</w:del>)", re.S)
INS_TAG = re.compile(r"</?w:ins\b[^>]*>")
RUN = re.compile(r"<w:r(?:\s[^>]*)?>.*?</w:r>|<w:r(?:\s[^>]*)?/>", re.S)
RPR = re.compile(r"<w:rPr>.*?</w:rPr>|<w:rPr/>", re.S)
WT = re.compile(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>|<w:t(?:\s[^>]*)?/>", re.S)
RSID = re.compile(r'\sw:rsid\w*="[^"]*"')


def accepted_view(xml: str) -> str:
    """The document as if every revision were accepted: w:del removed, w:ins unwrapped."""
    return INS_TAG.sub("", DEL.sub("", xml))


def skeleton(xml: str) -> list[str]:
    """Tag sequence without text; each run is one token R(rPr, non-text children); equal neighbouring runs merge.

    Splitting a run to edit part of it (prefix / insertion / suffix with the same formatting)
    therefore leaves the skeleton unchanged, while any formatting, table, style or structure
    change does not."""
    xml = RSID.sub("", accepted_view(xml))
    out: list[str] = []
    pos = 0
    for m in RUN.finditer(xml):
        out += re.findall(r"<(/?[\w:]+)", xml[pos:m.start()])
        run = m.group(0)
        rpr = RPR.search(run)
        body = RPR.sub("", run)
        text = "".join(t or "" for t in WT.findall(body))
        children = [c for c in re.findall(r"<([\w:]+)", body) if c not in ("w:r", "w:t")]
        if text or children:
            tok = f"R({rpr.group(0) if rpr else ''}|{','.join(children)})"
            if not out or out[-1] != tok:
                out.append(tok)
        pos = m.end()
    out += re.findall(r"<(/?[\w:]+)", xml[pos:])
    return out


def docx_text(xml: str) -> str:
    """Visible text of the accepted view, one line per paragraph, XML entities decoded."""
    xml = accepted_view(xml)
    paras = re.findall(r"<w:p(?:\s[^>]*)?>.*?</w:p>", xml, re.S)
    return "\n".join(html.unescape("".join(t or "" for t in WT.findall(p))) for p in paras)


def docx_gates(name: str, orig_p: Path, out_p: Path, facts: list[str]) -> None:
    a, b = docx_parts(orig_p), docx_parts(out_p)
    doc_a, doc_b = a["word/document.xml"].decode("utf-8"), b.get("word/document.xml", b"").decode("utf-8")
    sa, sb = skeleton(doc_a), skeleton(doc_b)
    first = next((i for i, (x, y) in enumerate(zip(sa, sb)) if x != y), min(len(sa), len(sb)))
    gate(name, "docx skeleton", sa == sb,
         f"{len(sa)} tokens identical (revisions accepted, split runs merged)" if sa == sb
         else f"CHANGED at token {first}: {sa[first:first + 3]} -> {sb[first:first + 3]}")
    others = sorted(set(a) - {"word/document.xml"})
    changed = [n for n in others if a[n] != b.get(n)]
    extra = sorted(set(b) - set(a))
    gate(name, "docx parts", not changed and not extra,
         f"{len(others)} other parts byte-identical" if not changed and not extra
         else f"changed/lost: {changed}; added: {extra}")
    text_gates(name, docx_text(doc_a), docx_text(doc_b), facts)


# ---------- main ----------

def inputs(manifest: Path) -> list[tuple[str, Path, list[str]]]:
    """(name relative to the outputs root, input path, facts)."""
    found = [(f"corpus/{p.name}", p, FACTS) for p in sorted(CORPUS.iterdir()) if p.is_file()]
    if manifest.exists():
        for doc in json.loads(manifest.read_text(encoding="utf-8"))["docs"]:
            found.append((f"reference/{doc['file']}", REFERENCE / doc["file"], doc["facts"]))
    return found


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--outputs", type=Path, required=True, help="folder holding corpus/ and reference/ outputs")
    ap.add_argument("--manifest", type=Path, default=REFERENCE / "manifest.json")
    args = ap.parse_args()
    outputs = args.outputs.resolve()
    if not CORPUS.exists():
        sys.exit("Run make_corpus.py first.")
    say(f"# writing-check trust gates: {outputs.name}\n")
    missing = 0
    for name, orig_p, facts in inputs(args.manifest):
        out_p = outputs / name
        say(f"## {name}")
        if not out_p.exists():
            gate(name, "output", False, f"no output at {out_p}")
            missing += 1
            continue
        if orig_p.suffix == ".docx":
            docx_gates(name, orig_p, out_p, facts)
        else:
            text_gates(name, orig_p.read_text(encoding="utf-8"), out_p.read_text(encoding="utf-8"), facts)
        say()
    failed = [r for r in results if not r[2]]
    say("# Summary\n")
    say("| Gate | Pass | Fail |")
    say("|---|---|---|")
    for g in dict.fromkeys(r[1] for r in results):
        rs = [r for r in results if r[1] == g]
        say(f"| {g} | {sum(r[2] for r in rs)} | {sum(not r[2] for r in rs)} |")
    say(f"\n{'FAIL' if failed else 'PASS'}: {len(results) - len(failed)}/{len(results)} gate checks passed"
        + (f"; failed: {[(r[0], r[1]) for r in failed]}" if failed else ""))
    (outputs / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
