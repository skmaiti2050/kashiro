# Trust suite

The release gate for writing-check (spec sections 9 and 10). It shows, on every release, that the app keeps
facts, formatting and meaning intact, and that review stays within budget. Every check is pass/fail. A
failing check blocks the release.

```
npm run trust     # corpus + CLI runs + gates + negative control; exits non-zero on any failure
npm test          # includes tests/decisions.test.ts, the review-budget gate
```

Requires Node and Python 3 (stdlib only). Nothing in the suite touches the network.

## What `npm run trust` does

1. **Corpus.** `make_corpus.py` regenerates `trust/corpus/` (gitignored). The output is deterministic.
2. **CLI runs.** Runs `cli/check-file.ts --accept-all-rules` on every corpus file and every reference document,
   in both save modes (`tracked`, `clean`), into `trust/out/<mode>/` (gitignored). `--accept-all-rules` is
   the maximum opt-in: every rule-based decision with a single fix is accepted. Each run has
   `block_network.cjs` preloaded, so any network attempt (http, https, net, tls, dgram, fetch other than
   `data:`) crashes the run and fails the gate.
3. **Fact-lock gate** (in process): no auto-applied edit, and no edit accepted by accept-all, overlaps a
   fact-locked span.
4. **`analyze.py --outputs trust/out/<mode>`** for each mode:

   | Gate | Passes when |
   |---|---|
   | facts | every planted fact present in the input is present verbatim in the output |
   | invisible | no zero-width character (ZWSP, ZWNJ, ZWJ, WJ, BOM, soft hyphen) is left in Latin context, and none was added. Joiners next to Indic or Arabic script are allowed; a leading file BOM is not counted |
   | spans | LaTeX and code spans (fenced and inline code, `$…$`, `$$…$$`, `\commands`) are byte-identical and in order |
   | docx skeleton | `word/document.xml` has the same structure as the input once revisions are accepted (`w:del` removed, `w:ins` unwrapped) and split runs with identical formatting are merged. Bold, italics, tables, styles and paragraphs must all match |
   | docx parts | every other package part (header, styles, metadata, relationships) is byte-identical |

5. **Negative control.** A copy of the outputs is damaged once per gate (a changed number, a planted ZWSP,
   an edited `$math$`, a lost `<w:b/>`, an edited header). `analyze.py` must fail every one of them. A gate
   that cannot fail proves nothing.

`analyze.py` writes its full report to `trust/out/<mode>/report.md`.

## Inputs

**Corpus** (`make_corpus.py`): academic prose full of facts (dates, counts, `p < 0.001`, `INR 450`,
`Dr. Anjali Rao`, citations) with planted errors the app should fix; the same prose with zero-width
characters planted every 40 characters; Markdown with inline code, math and fenced Python and JavaScript
blocks (with blank lines inside); LaTeX-flavoured Markdown and plain text; and a .docx with a header, a
table, bold and italic runs, a custom style and core and custom metadata. The app accepts only .txt, .md
and .docx, so LaTeX and code are tested as spans inside those formats.

**Reference documents** (`reference/`): 20 realistic documents, five per writing-goal preset, of which
at least two per preset are .docx. See `reference/README.md` for word counts and planted errors, and
`reference/manifest.json` for the answer key and facts. Regenerate them with `npm run trust:reference`
after editing a source in `reference/src/`.

## Review budget

`tests/decisions.test.ts` checks every reference document: decisions in the default view
(`CheckSession.decisionCount()`) × 1,500 / words ≤ 10, and no auto-applied or accept-all edit on a
fact-locked span. It writes the per-document table to `trust/out/decisions.md`.

## Where this came from

Ported from an audit kit written to test the claims of a "humanizer" tool (`make_corpus.py`,
`analyze.py`). The kit's preservation checks became gates here. Its XML escaping fix stays (`p < 0.001`
must be `&lt;` inside a .docx part), and docx text is unescaped before facts are compared, so facts with
`<` or `&` are checked as well. Dropped from the port because they test claims this app does not make, or
because they need the network: signature-phrase removal, similarity-fingerprint evasion, SynthID,
metadata stripping (this app must keep metadata, which the docx parts gate checks), determinism as a
claim, and Crossref reference lookups.

## Known limits

- Harper's dictionary has no Indian-English vocabulary (taluka, sarpanch, borewell, dhaba, poha, …), so
  these words become review decisions. They are the largest share of decisions in the reference set. A
  bundled en-IN word list would cut them.
- Harper suggests the Oxford comma (kind Style) even in British and Indian English documents.
- An a/an swap is a safe rule, so a typo of "and" written as "an" before a pronoun is "fixed" to "a".
  The text was already wrong, so meaning is not changed, but the fix is not the right one.
