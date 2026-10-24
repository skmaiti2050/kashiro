# Trust suite

The release gate for Kashiro (spec sections 9 and 10). It shows, on every release, that the app keeps
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
   `block_network.cjs` preloaded. It fails closed: any network attempt (http, https, TCP via net, tls,
   dgram, dns lookups, fetch other than `data:`) throws, forces exit code 99 and writes a marker file,
   so code that catches the error still fails the gate. Local IPC (named pipes and Unix sockets, which
   tsx uses to talk to its parent process) is allowed. Patches are synced to ESM imports of the builtins.
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

**Reference documents** (`reference/`): realistic documents, at least five per writing-goal preset, of which
at least two per preset are .docx (22 in all: the original 20 plus 2 written afterwards and never edited to fit). See `reference/README.md` for word counts and planted errors, and
`reference/manifest.json` for the answer key and facts. Regenerate them with `npm run trust:reference`
after editing a source in `reference/src/`.

## Review budget

`tests/decisions.test.ts` checks every reference document. It is deliberately stricter than spec
section 10's "default view" count, so it cannot pass by capping:

- **Budget:** all ranked pending decisions (`CheckSession.rankedDecisionCount()`: the top and "more",
  excluding only candidates inside an existing tracked change) × 1,500 / words ≤ 10.
- **Recall:** no planted error that the engine detects may be hidden. A planted safe error must be
  auto-applied or ranked, and a planted judgment error must be ranked (never auto-applied). Planted errors
  that the engine does not detect at all are listed in the table.
- No auto-applied or accept-all edit touches a fact-locked span.
- **Recall floor:** across the corpus, the share of planted safe and judgment errors found stays at or
  above the level measured in Task F3, minus two points, so recall can't drop by the engine seeing less.

`tests/cleanText.test.ts` is the other side: the correct prose in `trust/clean/` (legitimate doublings such
as "had had" and "What it is is", names, Indian English, list labels, acronyms, amounts, URLs, code) gets no
automatic change under any preset, and only a few decisions. `tests/engine/neverDamage.test.ts` checks
several hundred generated trap sentences with every auto-apply setting on.

Nothing is folded out of the ranking. Candidates on fact-locked spans (names, numbers, quotes), repeats
of the same unknown word and similar low-value items are demoted (score 0, ranked last), so they fill
empty top slots instead of disappearing. The per-document table is written to `trust/out/decisions.md`.

## Where this came from

Ported from an audit kit written to test the claims of a "humanizer" tool (`make_corpus.py`,
`analyze.py`). The kit's preservation checks became gates here. Its XML escaping fix stays (`p < 0.001`
must be `&lt;` inside a .docx part), and docx text is unescaped before facts are compared, so facts with
`<` or `&` are checked as well. Dropped from the port because they test claims this app does not make, or
because they need the network: signature-phrase removal, similarity-fingerprint evasion, SynthID,
metadata stripping (this app must keep metadata, which the docx parts gate checks), determinism as a
claim, and Crossref reference lookups.

## Known limits

- **The review budget fails on most reference documents** (see `trust/out/decisions.md`). The largest
  share is names and other capitalised words that Harper's dictionary does not know, counted once per
  occurrence. A screenplay's speaker names alone exceed the budget. Indian-English vocabulary outside
  the bundled word list (`src/engine/wordlists/en-IN.ts`) is the next largest share.
- Harper misses many agreement and word-choice errors, and some doubled words. Those planted errors
  are reported as "not detected"; they are not hidden by the app.
- The Oxford-comma suggestion is hidden for British and Indian English and kept for other variants.
- An a/an fix is safe only before a lowercase content word ("a apple"). Before a pronoun,
  conjunction, determiner, auxiliary, `not`, a name, an acronym, a number or punctuation, it goes to
  review ("an they" is usually "and they").
