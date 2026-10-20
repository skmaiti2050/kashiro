# writing-check v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows desktop app that checks .docx/.txt/.md (or pasted text) offline with Harper plus an optional local LLM, auto-applies only safe fixes, keeps review to ≤10 decisions per 1,500 words, and saves back with formatting intact as native tracked changes.

**Architecture:** All checking logic is a pure TypeScript engine (`src/engine`, `src/formats`) that runs both in the Tauri webview and in Node. Node runs the unit tests and a headless CLI that the trust suite drives. The Rust side (`src-tauri`) is thin: file dialogs and fs (via plugins), hashing a downloaded model, and starting/stopping the `llama-server` sidecar. Documents become a list of paragraphs. Every edit is stored as an offset range against the *original* paragraph text, so undo is a toggle and output = original + accepted edits. Format adapters splice edits into the original bytes and never re-serialise untouched XML.

**Tech Stack:** Tauri 2 (`@tauri-apps/cli` 2.12, plugins dialog/fs/store/upload), React 18 + Vite, TypeScript strict, `harper.js` 2.13 (WASM), CodeMirror 6, JSZip 3.10, Vitest 3, llama.cpp `llama-server` (sidecar), Python 3 for the trust suite.

**Spec:** `docs/superpowers/specs/2026-10-20-writing-check-design.md` (read it before Task 1).

## Global Constraints

- No network calls by default. The only network use is the user-initiated model download. No telemetry. No update checks in v1.0.
- No admin rights, no system hooks, no accessibility/keyboard permissions, no Office add-ins. Per-user install only.
- The LLM may never auto-apply. "Accept all LLM suggestions" is at most an explicit, visible action.
- Fact-locked spans (numbers, dates, names, quotes, citations, URLs, code, LaTeX math) are never changed automatically. Any suggestion touching them goes to Review.
- Never auto-convert between English variants. Never auto-correct unknown capitalised words, acronyms or non-English words.
- No humanizer / AI-detection / watermark / plagiarism-checker wording anywhere in UI, README or release notes.
- The default save is a new copy `name.checked.<ext>`. Overwrite-with-backup is an option. Tracked changes are the default for .docx (author `writing-check`). "Save clean" is an option.
- Nothing Windows-only in `src/engine` or `src/formats` (v1.1 adds macOS/Linux).
- Usable on an 8 GB RAM laptop without a GPU. The rules pass feels instant (<300 ms for 1,500 words). The LLM pass shows progress and can be cancelled.
- Licence: Apache-2.0 *(Claude's call: matches Harper; compatible with llama.cpp MIT)*.

## Review Focus

1. **Non-BMP text and Indic scripts** (emoji, ₹, Devanagari/Bengali with ZWJ/ZWNJ). Offsets must stay aligned, and legitimate ZWJ/ZWNJ inside Indic words or emoji sequences must not be stripped as "invisible characters". Tests are in Task 3 (hygiene) and Task 9 (docx offsets).
2. **XML entities and special run content in .docx** (`&lt;`, `&amp;`, `w:tab`, `w:br`, `w:sym`, text split across runs). Extracted text must equal what Word shows, and written text must be re-escaped (`p < 0.001` broke the audit kit once). Tests are in Task 8 and Task 9.
3. **Line endings and BOM in .txt/.md.** A CRLF file with a UTF-8 BOM must come back CRLF with its BOM, and only the edited characters may change. Test is in Task 7.
4. **Edits that can't be placed safely** (across a hyperlink boundary, inside a field, inside an existing tracked change). They must be skipped and reported in the change log, never written half-way. Test is in Task 9.
5. **Personal names flagged as misspellings** (Harper suggests "Suit"/"Sit" for "Sujit" and worse). These must land in Review with "add to dictionary", never in Safe, and must stay out of the top-10 list unless nothing else exists. Test is in Task 5.

---

## Milestone A: Engine on plain text (headless, Node-tested)

### Task 1: Toolchain, repo and scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `.gitignore`, `LICENSE`, `README.md`
- Create: `src-tauri/` (via `npm create tauri-app` template "react-ts", then trimmed)
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` (vitest, Node env), `npm run tauri dev`, path alias `@/` → `src/`.

- [ ] **Step 1: Prerequisites (owner does these by hand; they need an installer and possibly admin on the dev machine, which is fine for development only).** Install Visual Studio 2022 Build Tools with the "Desktop development with C++" workload, then rustup (`winget install Rustlang.Rustup`). Verify with `rustc --version` and `cargo --version` in a new shell. WebView2 ships with Windows 11.
- [ ] **Step 2:** In `D:\Projects\writing-check`, run `git init`. Scaffold Tauri 2 + React + TS into the existing folder, keeping `docs/`. Set the app identifier `app.writingcheck.desktop`, productName `writing-check`, and window title "writing-check".
- [ ] **Step 3:** Add deps: `harper.js@2.13.0`, `jszip@3.10.2`, `@codemirror/state`, `@codemirror/view`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-store`, `@tauri-apps/plugin-upload`. Dev deps: `vitest@3`, `fast-xml-parser` (XML well-formedness checks in tests), `tsx`.
- [ ] **Step 4:** Write `tests/smoke.test.ts` asserting `new LocalLinter({ binary: binaryInlined }).lint("teh cat")` returns one lint of kind `Typo` with suggestion `the`. Import `binaryInlined` from `harper.js/binaryInlined`.
- [ ] **Step 5:** Run `npm test`. Expected: 1 passed. Run `npm run tauri dev`. Expected: an empty window titled "writing-check".
- [ ] **Step 6:** Commit the spec, plan and scaffold: `git add -A && git commit -m "chore: scaffold Tauri 2 + React + TS, harper.js smoke test"`

### Task 2: Core types and the Harper wrapper

**Files:**
- Create: `src/engine/types.ts`, `src/engine/linter.ts`
- Test: `tests/engine/linter.test.ts`

**Interfaces:**
- Produces (in `types.ts`):
  ```ts
  type Variant = 'American' | 'British' | 'Australian' | 'Canadian' | 'Indian';
  interface Paragraph { id: number; text: string; locked?: Span[] }   // locked: adapter-supplied (e.g. existing tracked changes)
  interface Span { start: number; end: number }                          // UTF-16 offsets into Paragraph.text, end exclusive
  type Source = 'rules' | 'hygiene' | 'llm' | 'preset';
  interface Candidate {
    id: string; paraId: number; span: Span; original: string;
    replacements: string[];          // [] for "no fix, just a flag"
    kind: string;                    // Harper LintKind, or 'Invisible' | 'Variant' | 'Contraction' | 'Rewrite'
    message: string; source: Source;
  }
  type Tier = 'safe' | 'batch' | 'review' | 'hidden';
  ```
- Produces (in `linter.ts`): `createLinter(variant: Variant, words?: string[]): Promise<RulesLinter>` and `RulesLinter.lintParagraphs(paras: Paragraph[], language: 'plaintext' | 'markdown'): Promise<Candidate[]>`, plus `RulesLinter.addWords(words: string[]): Promise<void>`.

- [ ] **Step 1:** Write tests:
  - `"I has went their."` gives candidates of kinds `Agreement` (`has` → `[have]`) and `Grammar` (`went` → `[gone]`).
  - `"Priya said 😀 that their is"`: the `their` candidate has `original === "their"` sliced with its span (proves UTF-16 offsets survive an emoji).
  - `addWords(["Sujit"])` removes the `Spelling` candidate for `"Sujit went home."`.
  - `language: 'markdown'` ignores text inside backticks (`` `teh` `` gives no candidate).
- [ ] **Step 2:** Run `npm test -- linter`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement with `LocalLinter`, using `Dialect[variant]`. Candidate ids are `${paraId}:${start}:${end}:${kind}`. Call `.free()` on WASM objects after copying their fields.
- [ ] **Step 4:** Run `npm test -- linter`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(engine): harper wrapper and core types`

### Task 3: Hygiene and fact lock

**Files:**
- Create: `src/engine/hygiene.ts`, `src/engine/factLock.ts`
- Test: `tests/engine/hygiene.test.ts`, `tests/engine/factLock.test.ts`

**Interfaces:**
- Produces: `findInvisible(p: Paragraph): Candidate[]` (kind `'Invisible'`, replacement `''`, source `'hygiene'`) and `findLockedSpans(text: string): Span[]` (sorted, merged).

- [ ] **Step 1:** Write the hygiene tests:
  - Each of U+200B, U+2060, U+FEFF (anywhere in a paragraph) and U+00AD between Latin letters is flagged.
  - U+200C/U+200D between two Latin letters are flagged.
  - Not flagged: U+200D inside `👨‍👩‍👧`; U+200D or U+200C adjacent to Devanagari (U+0900–097F), Bengali (U+0980–09FF) or other Indic/Arabic-script letters (e.g. `क्‍ष`, `ক্‌ষ`).
  - Each invisible character is its own candidate.
- [ ] **Step 2:** Write the factLock tests. Each of these is fully covered by a locked span:
  - `3 March 2025`, `2025-03-03`
  - `₹1,200`, `p < 0.001`, `45%`, `v2.3.1`
  - `https://exmple.com/teh`, `a@b.co`
  - `"quoted words"` (straight and curly quotes)
  - `[12]`, `(Smith, 2020)`, `(Smith et al., 2020, p. 4)`
  - `` `code` ``, `$x^2$`, `$$\int f$$`, `\cite{key}`
  - capitalised words not at sentence start (`went to Kolkata with Sujit`), and ALL-CAPS acronyms (`NASA`).

  The sentence-initial `The` is *not* locked.
- [ ] **Step 3:** Run both tests. Expected: FAIL.
- [ ] **Step 4:** Implement both with regexes. "Sentence start" means the start of the paragraph, or after `.?!:` plus whitespace, or after an opening quote/bracket.
- [ ] **Step 5:** Run them. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(engine): invisible-char hygiene and fact lock`

### Task 4: English variant detection

**Files:**
- Create: `src/engine/variant.ts`
- Test: `tests/engine/variant.test.ts`

**Interfaces:**
- Consumes: `createLinter` (Task 2).
- Produces: `detectVariant(paras: Paragraph[], fallback: Variant): Promise<{ variant: Variant; mixed: boolean; variantWords: Set<string> }>`. `variantWords` holds the lowercased words flagged as Spelling under the chosen variant but accepted by at least one other variant.

- [ ] **Step 1:** Write tests:
  - "The colour of the organised behaviour" gives `British` (or `Indian`/`Australian`, all acceptable; assert `!== 'American'`).
  - "The color of the organized behavior" gives `American`.
  - A text containing both "colour" and "color" gives `mixed: true`.
  - With no variant-specific words, the result is `fallback`.
  - "teh" is never in `variantWords`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement: lint with each of the 5 dialects, count `Spelling` lints, pick the minimum (ties go to `fallback`, then to `American`). `mixed` = both the chosen dialect and its opposite have ≥1 Spelling lint that the other doesn't.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(engine): per-document English variant detection`

### Task 5: Presets, tiers, batching and ranking

**Files:**
- Create: `src/engine/presets.ts`, `src/engine/tiers.ts`
- Test: `tests/engine/tiers.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `Span`, `findLockedSpans`, `variantWords`.
- Produces:
  ```ts
  type PresetId = 'academic' | 'blog' | 'script' | 'business';
  interface Preset { id: PresetId; label: string; hiddenKinds: string[]; reviewKinds: string[]; extraRules: ('contractions')[] }
  const PRESETS: Record<PresetId, Preset>;
  interface TierContext { locked: Map<number, Span[]>; variantWords: Set<string>; preset: Preset; userTierOverrides?: Partial<Record<string, Tier>> }
  function tierOf(c: Candidate, ctx: TierContext): Tier;
  interface Decision { id: string; kind: 'single' | 'batch'; candidateIds: string[]; label: string; score: number }
  function buildDecisions(cands: Candidate[], tiers: Map<string, Tier>): { safe: string[]; decisions: Decision[] };   // decisions sorted by score desc
  function findContractions(p: Paragraph): Candidate[];   // kind 'Contraction', source 'preset'
  ```

- [ ] **Step 1:** Write the tier tests (fixed rules from spec §5):
  - **Safe:** source `hygiene`, or source `rules` with kind in {Spelling, Typo, Repetition, Punctuation, Capitalization, Formatting}, or kind `Miscellaneous` where the original is `a`/`an` and the replacement is the other. Exactly one replacement, no overlap with a locked span, original not starting with an uppercase letter (except kind Capitalization), and lowercased original not in `variantWords`.
  - `teh` → safe. `Sujit` (3 suggestions) → review. A single-suggestion spelling of a capitalised word → review. `colour` when `variantWords` has it → review. `Its → [It's, It has]` → review. `has → [have]` (Agreement) → review. A Typo overlapping `https://...` → review. Any `llm` source → review.
  - **Presets:**
    - `script` hides Style, Readability, Enhancement and sentence-fragment lints.
    - `academic` adds `findContractions` candidates as review (`don't` → `do not`).
    - `blog` hides Enhancement.
    - `business` hides nothing.
  - `userTierOverrides: { Agreement: 'safe' }` makes `has → have` safe. An override of `llm` to `safe` is ignored (assert still review).
- [ ] **Step 2:** Write the decision tests:
  - Nine review candidates `it's → its` in different paragraphs give one decision of kind `batch` with 9 ids and label `it's → its (9 places)`.
  - Two identical review candidates give a batch; one stays single.
  - Ranking: score by kind weight (Grammar/Agreement/Malapropism/Eggcorn 5, WordChoice/Usage/WordOrder 4, Rewrite 4, Punctuation/Variant 3, Contraction 2, Style/Readability/Enhancement/Redundancy 1). A batch gets +1. Capitalised-word Spelling flags (names) score 0. *(Claude's call.)*
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement. Batch key = `kind + lower(original) + '→' + replacements[0]`, for review-tier candidates with exactly one replacement.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(engine): presets, risk tiers, batching, ranking`

### Task 6: Check session, change log, undo and report

**Files:**
- Create: `src/engine/session.ts`, `src/engine/report.ts`
- Test: `tests/engine/session.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  interface CheckOptions { preset: PresetId; variant?: Variant; fallbackVariant: Variant; language: 'plaintext' | 'markdown'; dictionary: string[] }
  interface Edit { paraId: number; span: Span; replacement: string }
  type Status = 'pending' | 'applied' | 'rejected' | 'superseded';
  interface LogEntry { candidateId: string; status: Status; auto: boolean; at: string; reason?: string }
  class CheckSession {
    static start(paras: Paragraph[], opts: CheckOptions): Promise<CheckSession>;
    readonly variant: Variant; readonly mixedVariant: boolean;
    candidates(): Candidate[]; tier(id: string): Tier;
    decisions(): { top: Decision[]; more: Decision[] };   // top = first 10
    decisionCount(): number;                                // = top.length (spec §10 definition)
    accept(decisionId: string, replacementIndex?: number): void;
    reject(decisionId: string): void;
    undo(candidateId: string): void;                        // applied → rejected; rejected (by user) → pending
    addCandidates(c: Candidate[]): void;                    // LLM results (Task 13)
    markUnplaceable(candidateId: string, reason: string): void;   // from adapters (Task 9)
    log(): LogEntry[];
    acceptedEdits(): Edit[];                                // non-overlapping, sorted
    outputText(paraId: number): string;
  }
  function exportReport(s: CheckSession, fileName: string): string;   // Markdown
  ```

- [ ] **Step 1:** Write tests:
  - `start` auto-applies safe candidates (log entries `auto: true`).
  - `outputText` for `"I think teh cat is is here."` is `"I think the cat is here."`.
  - Accepting a batch applies all of its candidates. `undo` on one candidate of a batch restores only that one.
  - Accepting a candidate that overlaps an applied one → the newer one is applied and the older one becomes `superseded` (LLM-over-rules case), and `acceptedEdits()` never overlap.
  - `decisions().top.length <= 10`.
  - `exportReport` lists every applied/rejected/unplaceable entry with before/after and the paragraph number, and says "auto" for safe fixes.
  - A paragraph `locked` span from the adapter makes any candidate overlapping it review-only, and accept on it calls nothing (stays pending, with reason "inside an existing tracked change").
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Edits always reference original offsets, and `outputText` applies them right-to-left.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(engine): check session with change log, undo and report`

### Task 7: .txt/.md adapter and headless CLI

**Files:**
- Create: `src/formats/types.ts`, `src/formats/text.ts`, `src/formats/registry.ts`, `cli/check-file.ts`
- Test: `tests/formats/text.test.ts`, `tests/cli.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type SaveMode = 'tracked' | 'clean';
  interface FormatAdapter {
    exts: string[];
    language: 'plaintext' | 'markdown';
    read(bytes: Uint8Array): Promise<{ paras: Paragraph[]; handle: unknown }>;
    write(handle: unknown, edits: Edit[], mode: SaveMode): Promise<{ bytes: Uint8Array; unplaceable: { edit: Edit; reason: string }[] }>;
  }
  function adapterFor(fileName: string): FormatAdapter | null;
  ```
  CLI: `npx tsx cli/check-file.ts <in> <out> [--preset blog] [--mode tracked|clean] [--accept-all-rules] [--report out.md]` applies safe fixes (plus all non-LLM review items with `--accept-all-rules`), writes `<out>`, and prints JSON `{ variant, safe, decisions, unplaceable }`.

- [ ] **Step 1:** Write tests for the text adapter:
  - The whole file is one Paragraph per blank-line-separated block, and offsets map back exactly.
  - A UTF-8 BOM + CRLF input with `teh` comes back with BOM and CRLF intact, and `diff` = only `teh`→`the`.
  - A Latin-1-invalid byte sequence is rejected with a clear error (`"not UTF-8 text"`).
  - `mode` is ignored for text (always clean).
  - `.md` uses `language: 'markdown'`.
- [ ] **Step 2:** Write the CLI test: run the CLI on a fixture with `globalThis.fetch`, `http.request`, `https.request` and `net.connect` patched to throw, and assert exit code 0 (the no-network check from spec §9).
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run `npm test`. Expected: all PASS. Manually run `npx tsx cli/check-file.ts D:\Projects\turnitout-audit\corpus\prose.txt %TEMP%\prose.checked.txt` and read the JSON.
- [ ] **Step 6:** Commit: `feat(formats): text/markdown adapter and headless CLI`

## Milestone B: .docx in place with tracked changes

### Task 8: .docx reading (tokenizer + extraction)

**Files:**
- Create: `src/formats/docx/tokenize.ts`, `src/formats/docx/extract.ts`
- Test: `tests/formats/docx/extract.test.ts`, fixtures `tests/fixtures/docx/*.docx` (built by `tests/fixtures/make_docx.ts` with JSZip, so they're reproducible)

**Interfaces:**
- Produces:
  ```ts
  interface TextPiece { paraOffset: number; length: number; xmlStart: number; xmlEnd: number;   // xml range of the decoded content inside <w:t>
                        runStart: number; runEnd: number; rPr: string;                        // run's xml range and verbatim <w:rPr>…</w:rPr> ('' if none)
                        kind: 'text' | 'special'; container: 'plain' | 'hyperlink' | 'ins' | 'field' }
  interface DocxPara { para: Paragraph; pieces: TextPiece[] }
  function extractDocx(documentXml: string, firstId: number): DocxPara[];
  ```
  `special` pieces (`w:tab`→`\t`, `w:br`/`w:cr`→`\n`, `w:sym`/`w:noBreakHyphen`/`w:softHyphen`→U+FFFC) are length 1 and are added to `para.locked`. Text inside `w:del` and `w:instrText` is excluded. Text inside `w:ins` is included and locked. Field results (between `fldChar separate` and `end`) are included and locked.

- [ ] **Step 1:** Write tests:
  - `<w:t>p &lt; 0.001 &amp; more</w:t>` gives text `p < 0.001 & more`.
  - `<w:t xml:space="preserve"> lead</w:t>` keeps the space.
  - "Hel" (bold run) + "lo" (plain run) gives `Hello` with 2 pieces.
  - Tables: each cell paragraph is its own Paragraph.
  - `w:tab` gives `\t` and is locked.
  - Text inside an existing `w:del` is absent. Text inside an existing `w:ins` is present and locked.
  - A hyperlink's text is present with container `hyperlink`.
  - Emoji/Bengali text keeps UTF-16 lengths equal to the decoded string.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement a single forward scan over the XML string (no DOM; regex for tags, tracking a stack of open element names). Decode the 5 XML entities and numeric character references.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(docx): offset-preserving extraction`

### Task 9: .docx writing (tracked and clean) and the adapter

**Files:**
- Create: `src/formats/docx/write.ts`, `src/formats/docx/index.ts`; register in `src/formats/registry.ts`
- Test: `tests/formats/docx/write.test.ts`

**Interfaces:**
- Consumes: `extractDocx`, `Edit`, `SaveMode`, `FormatAdapter`.
- Produces: `docxAdapter: FormatAdapter`. `write` touches only `word/document.xml`; every other zip entry is copied with identical bytes, in the same order. *(Claude's call: headers, footers, footnotes and comments are preserved untouched but not checked in v1.0; the UI says so.)*

- [ ] **Step 1:** Write tests (parse the output with `fast-xml-parser` `XMLValidator`, and compare with `extractDocx`):
  - **Tracked:** `teh`→`the` inside a run with `<w:rPr><w:b/></w:rPr>` gives prefix run + `<w:del w:id w:author="writing-check" w:date>` holding a run with the same rPr and `<w:delText>teh</w:delText>` + `<w:ins …>` holding a run with the same rPr and `<w:t>the</w:t>` + suffix run. Re-extracted visible text (del excluded, ins included) equals the expected output.
  - `w:id` values are unique and greater than every existing `w:id` in the document.
  - **Clean:** the same edit gives the text replaced in place with formatting unchanged, and no `w:ins`/`w:del` added.
  - An edit spanning a bold+plain run boundary gives deletions of both segments, and the insertion uses the first segment's rPr.
  - **Unplaceable:** an edit crossing into a hyperlink, overlapping a field, an existing ins/del, or a special piece is returned in `unplaceable` with a reason, and the XML is unchanged there.
  - The replacement `a < b & "c"` is escaped as `a &lt; b &amp; "c"`. Leading/trailing spaces get `xml:space="preserve"`.
  - Every zip entry except `word/document.xml` is byte-identical (compare `async('uint8array')`).
  - Existing tracked changes in the fixture survive verbatim.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement: map each edit to pieces, then build replacement XML for the affected runs, then splice into the original string right-to-left. Use the `w:date` from an injectable clock.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Run the CLI on `D:\Projects\turnitout-audit\corpus` .docx in both modes. **Owner check:** open both outputs in Word. Tracked edits show in Review → Track Changes with author "writing-check". Upload the tracked file to Google Docs: the edits show as Suggestions.
- [ ] **Step 6:** Commit: `feat(docx): tracked-changes and clean writer`

### Task 10: Trust suite as the release gate

**Files:**
- Create: `trust/make_corpus.py`, `trust/analyze.py` (ported from `D:\Projects\turnitout-audit`), `trust/run_trust.ps1`, `trust/README.md`, `trust/reference/<preset>/*.{docx,md}` (5 per preset = 20 docs)
- Test: `tests/decisions.test.ts`

**Interfaces:**
- Consumes: the CLI (Task 7) and `CheckSession.decisionCount()`.
- Produces: `npm run trust` = `pwsh trust/run_trust.ps1`. It regenerates the corpus, runs the CLI (`--accept-all-rules`, both save modes) on every corpus file, runs `analyze.py --outputs trust/out`, and exits non-zero on any failed check.

- [ ] **Step 1:** Port the kit. Keep its docx XML escaping fix. Change `analyze.py` so verdicts become pass/fail gates for this app:
  - all planted facts survive;
  - docx skeleton identical apart from `w:ins`/`w:del`/edited runs;
  - zero invisible characters in the output (Latin context), none added;
  - LaTeX/code spans byte-identical.

  Drop the humanizer-specific claims (fingerprints, SynthID) from the gate.
- [ ] **Step 2:** Write the 20 reference docs: realistic text, 800-2,000 words, ~1 planted error per 100 words, mixing safe and judgment errors. Include Indian names and ₹ amounts. *(Claude's call: authored for the suite and kept in git.)*
- [ ] **Step 3:** Write `tests/decisions.test.ts`: for every reference doc, `decisionCount() * 1500 / words <= 10`, and no auto-applied edit overlaps a fact-locked span.
- [ ] **Step 4:** Run `npm test` and `npm run trust`. Expected: all pass. If the decision budget fails, tune the ranking/hiding in Task 5 (not the test).
- [ ] **Step 5:** Commit: `test: trust suite and review-budget gate`

## Milestone C: Desktop app

### Task 11: App shell: open, check, review, save

**Files:**
- Create: `src/ui/state/useSession.ts`, `src/ui/platform/files.ts`, `src/ui/platform/settings.ts`, `src/ui/Toolbar.tsx`, `src/ui/DocumentView.tsx`, `src/ui/ReviewPanel.tsx`, `src/ui/ChangeLog.tsx`, `src/ui/GoogleDocsHelp.tsx`; modify `src/ui/App.tsx`
- Modify: `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs` (register plugins dialog/fs/store)
- Test: `tests/ui/useSession.test.ts` (hook logic with a fake `files` module)

**Interfaces:**
- Consumes: `CheckSession`, `adapterFor`, `exportReport`.
- Produces: `files.open(): Promise<{ name: string; path: string; bytes: Uint8Array } | null>`, `files.save(path: string, bytes: Uint8Array, opts: { overwrite: boolean }): Promise<string>` (returns the written path; overwrite first copies the original to `name.bak.<ext>`), and `settings` (`preset`, `fallbackVariant` from `navigator.language`, `saveMode`, `overwrite`, `dictionary`, `tierOverrides`, `modelPath`) stored via plugin-store.

**Layout** *(Claude's call: one window, very few settings)*:
- **Toolbar:** Open · Paste · preset dropdown · variant chip (with "mixed" warning and override) · Save. The Save menu has "tracked changes (default) / clean" and "new copy (default) / overwrite with backup".
- **Left:** CodeMirror document view. It is read-only for .docx and editable for pasted/typed text and .txt/.md. Highlights show auto-fixes (subtle) and pending decisions (underlined).
- **Right:** the review panel with the counter "N decisions". It shows one decision at a time as a before/after diff with Accept / Reject / (for names) Add to dictionary. Batches have "Apply all / See each", and the rest sits under "More (N)".
- **Bottom drawer:** the change log with per-entry Undo and "Export report".
- **Settings:** a small panel with the default variant, the default save mode, the personal dictionary (list with remove), and "auto-apply these too" checkboxes per kind (writes `tierOverrides`; LLM and fact-locked are not offered).
- **Help:** the "Google Docs" help dialog: File → Download → .docx, drop here, fix, then File → Open → Upload in Docs. It has a drop zone.

- [ ] **Step 1:** Write hook tests:
  - open → session started → `decisionCount` shown.
  - accept/undo update `outputText`.
  - save with `tracked` calls `adapter.write` with `acceptedEdits()` and writes `name.checked.docx`; with overwrite it writes `.bak` first.
  - `unplaceable` results are passed to `markUnplaceable` and shown in the log.
  - Typing in the editor (text mode) re-runs the check debounced (300 ms) and keeps the decisions the user already made on unchanged paragraphs.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the hook, then the components. In the capabilities, allow `fs` read/write only on user-chosen paths (dialog scope), and set the CSP `connect-src 'self' ipc: http://ipc.localhost` (no remote hosts).
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Run `npm run tauri dev`, open the corpus .docx, accept 2 items, undo 1, save, and open the output in Word.
- [ ] **Step 5:** Commit: `feat(ui): open/check/review/save desktop flow`

### Task 11b: Offline word lookup

**Files:**
- Create: `scripts/build-dictionary.ts`, `src/engine/dictionary/lookup.ts`, `src/ui/LookupPanel.tsx`, `resources/dictionary/oewn.json.gz` (generated, committed), `resources/dictionary/ATTRIBUTION.md`
- Modify: `src/ui/ReviewPanel.tsx` ("Look up" toggle), `src/ui/DocumentView.tsx` (Ctrl+D and right-click → Look up on the selected word), the About text (attribution)
- Test: `tests/engine/dictionary/lookup.test.ts`, `tests/scripts/build-dictionary.test.ts`

**Interfaces:**
- Consumes: `Candidate` (original + replacements), the personal dictionary and `src/engine/wordlists/en-IN.ts` (Task 10).
- Produces:
  ```ts
  interface Sense { pos: 'noun' | 'verb' | 'adjective' | 'adverb'; definition: string; example?: string; synonyms: string[] }
  interface LookupResult { word: string; lemma: string; senses: Sense[]; inPersonalDictionary: boolean; inIndianEnglishList: boolean }
  function loadDictionary(bytes: Uint8Array): Promise<Dictionary>;          // gunzip + index, once
  interface Dictionary { lookup(word: string, opts: { personal: Set<string> }): LookupResult }
  ```
  `npm run build:dictionary -- <oewn-release.xml.gz>` writes `resources/dictionary/oewn.json.gz`.

- [ ] **Step 1:** The build script takes a pinned Open English WordNet WN-LMF XML release (record version, URL and sha256 in the script header; the owner downloads it once). It writes `{ lemma: [[posCode, definition, example?, synonyms[]]...] }`, keeping at most 3 senses and 5 synonyms per POS, then gzips. Test it on a 3-entry WN-LMF fixture: exact JSON shape, sense and synonym caps.
- [ ] **Step 2:** Write the lookup tests:
  - `affect` and `effect` both return verb/noun senses.
  - Inflections reach their lemma: `running` → `run`, `studies` → `study`, `better` → `good` via WordNet's exception lists, kept in the build output.
  - Case-insensitive.
  - Unknown word → `senses: []`.
  - `panchayat` → `inIndianEnglishList: true`.
  - A personal word → `inPersonalDictionary: true`.
  - The first lookup on the real file returns in < 300 ms after load.
- [ ] **Step 3:** Run. Expected: FAIL. Implement, then run. Expected: PASS.
- [ ] **Step 4:** UI:
  - **Review item:** "Look up" shows two columns (original | suggestion), each with up to 3 senses.
  - **Document view:** Ctrl+D or right-click on the current selection (expanded to the word under the cursor if empty) opens the panel. Esc closes it.
  - **Data loading:** the file loads lazily via `resolveResource`, with a "Loading dictionary…" state.
  - **About:** the About dialog shows the CC BY 4.0 attribution.
  - **No editing:** nothing in the panel edits text.
- [ ] **Step 5:** Run `npm test`. Check that the bundle size stays within the target (≤15 MB for the dictionary file). Manual check in `npm run tauri dev`.
- [ ] **Step 6:** Commit: `feat(lookup): offline word lookup for review items and selections`
## Milestone D: Optional "reads naturally" pass

### Task 12: LLM sidecar and model download

**Files:**
- Create: `scripts/fetch-llama.ps1`, `src-tauri/src/llm.rs`, `src/engine/llm/models.ts`, `src/ui/ModelSetup.tsx`
- Modify: `src-tauri/tauri.conf.json` (`bundle.externalBin: ["binaries/llama-server"]`), `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` (`sha2`, `tauri-plugin-shell`), capabilities, `.gitignore` (`src-tauri/binaries/`)
- Test: `src-tauri/src/llm.rs` `#[cfg(test)]` for `sha256_file`; `tests/engine/llm/models.test.ts`

**Interfaces:**
- Produces (Rust commands):
  - `sha256_file(path: String) -> Result<String, String>`
  - `llm_start(model_path: String) -> Result<u16, String>` spawns the `llama-server` sidecar on `127.0.0.1` at a free port with `--ctx-size 4096 --threads <physical cores>` and returns the port once `/health` answers 200.
  - `llm_stop() -> Result<(), String>`. The server is also killed on app exit.
- Produces (TS): `MODELS: ModelInfo[]` with `{ id, label, url, sha256, sizeBytes, licence }`, and `downloadModel(m: ModelInfo, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<string>`. It uses plugin-upload `download` into `appLocalDataDir()/models/`, verifies the sha256, and deletes the file on mismatch.

- [ ] **Step 1:** Choose the model *(builder's choice per spec §8)*. Candidates are permissively licensed (Apache-2.0/MIT) 1-4B instruct GGUFs at Q4_K_M (e.g. Qwen3-1.7B/4B, Phi-4-mini). Pick by running Task 13's guard on the 20 reference docs: highest share of guard-passing suggestions that a reader would accept, within 8 GB RAM and ≤5 s per sentence on CPU. Ship one default plus one "small" option. Record the URL and sha256 in `models.ts`.
- [ ] **Step 2:** `fetch-llama.ps1` downloads a pinned llama.cpp release (CPU/AVX2 Windows build), verifies its sha256, and copies `llama-server.exe` and its DLLs to `src-tauri/binaries/llama-server-x86_64-pc-windows-msvc.exe`.
- [ ] **Step 3:** Write a Rust test: `sha256_file` of a temp file containing `abc` equals `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`. Write a TS test: a mismatching hash deletes the file and rejects with `"download corrupted"` (mock plugin-upload).
- [ ] **Step 4:** Run `cargo test` in `src-tauri` and `npm test`. Expected: FAIL, then implement, then PASS.
- [ ] **Step 5:** ModelSetup:
  - The first-run card reads "Optional: download the reads-naturally helper (X GB). Grammar checking works without it." It has [Download] [Not now].
  - The download shows progress and can be cancelled.
  - Add the HuggingFace host to the upload plugin scope *only*. CSP adds `http://127.0.0.1:*`.
- [ ] **Step 6:** Commit: `feat(llm): llama-server sidecar and verified model download`

### Task 13: Sentence selection, rewrite and meaning-drift guard

**Files:**
- Create: `src/engine/llm/select.ts`, `src/engine/llm/prompt.ts`, `src/engine/llm/guard.ts`, `src/engine/llm/client.ts`; modify `src/ui/ReviewPanel.tsx` ("Check how it reads" button, progress, Cancel, "Check more sentences")
- Test: `tests/engine/llm/select.test.ts`, `tests/engine/llm/guard.test.ts`, `tests/engine/llm/client.test.ts`

**Interfaces:**
- Produces:
  - `pickSentences(session: CheckSession, budget: number): { paraId: number; span: Span; text: string }[]`. Budget = `max(1, round(3 * words / 1500))`. *(Claude's call: 3 per 1,500 words.)* Ranks sentences by: has a Readability/Style/WordOrder lint (+3), length > 30 words (+2), ≥2 rules candidates (+1). Already-reviewed sentences are excluded.
  - `passesGuard(original: string, rewrite: string, locked: string[]): { ok: boolean; reason?: string }`.
  - `LlmClient.rewrite(text: string, preset: PresetId, signal: AbortSignal): Promise<string | null>` POSTs `/completion` to the local port. Temperature 0.2, `n_predict` = 1.6× the input tokens. The prompt says: rewrite this one sentence to read naturally, keep the meaning, every number, name, quote and term, add no hedges or new claims, and return the sentence only (or `UNCHANGED`).
- LLM results enter the session as candidates with `source: 'llm'`, `kind: 'Rewrite'`, a span covering the whole sentence, and its accepted rule edits pre-applied in the text sent.

- [ ] **Step 1:** Write the guard tests. Each of these is rejected, with its reason:
  - a changed locked token (`3.2%`→`3%`): `fact changed`
  - length > 1.5× the original: `too long`
  - a negation count change (`not`, `no`, `never`, `n't`, `without`): `negation changed`
  - an added hedge (`broadly`, `arguably`, `generally`, `somewhat`, `perhaps`, `it seems`, `to some extent`, all from the Turnitout findings): `hedge added`
  - content-word overlap (lowercased, stopwords removed) < 0.6: `meaning drift` *(Claude's call: lexical overlap stands in for the spec's semantic-similarity threshold, so no extra embedding model is needed)*
  - multiple sentences returned: `not one sentence`

  A genuine fluency rewrite passes.
- [ ] **Step 2:** Write the select and client tests: the budget formula; ranking order; `UNCHANGED` → null; an aborted signal rejects; and the client calls only `127.0.0.1` (mock fetch).
- [ ] **Step 3:** Run. Expected: FAIL. Implement, then run. Expected: PASS.
- [ ] **Step 4:** In the UI:
  - LLM items are always review-tier and show the before/after diff.
  - "Accept all suggestions from the helper" is a separate, labelled button inside the LLM group and is never applied without a click.
  - Cancelling keeps the results that already came back.
- [ ] **Step 5:** Re-run `npm test` (decision budget still ≤10 with the LLM candidates added, using recorded rewrites as fixtures) and `npm run trust`.
- [ ] **Step 6:** Commit: `feat(llm): budgeted sentence rewrites with meaning-drift guard`

## Milestone E: Private Windows build

### Task 14: Per-user packaging and private release

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`bundle.targets: ["nsis"]`, `bundle.windows.nsis.installMode: "currentUser"`, WebView2 `downloadBootstrapper` off → `skip` with a README note), `README.md`
- Create: `scripts/portable-zip.ps1`, `docs/INSTALL.md`

**Interfaces:**
- Produces: `src-tauri/target/release/bundle/nsis/writing-check_1.0.0_x64-setup.exe` and `dist-portable/writing-check-1.0.0-win-x64.zip` (exe + sidecar + resources, runs from any user folder).

- [ ] **Step 1:** Configure the per-user NSIS installer and write the portable zip script.
- [ ] **Step 2:** Write `INSTALL.md`:
  - unsigned build: SmartScreen → "More info" → "Run anyway";
  - "if your organisation blocks unsigned apps, don't work around it; ask IT or wait for the signed release";
  - first-run model download is optional.
- [ ] **Step 3:** Run `npm test`, `cargo test`, `npm run trust` and `npm run tauri build`. Expected: all green and both artifacts produced.
- [ ] **Step 4:** **Owner check** on a standard (non-admin) Windows user account:
  - install the per-user build and unzip the portable one;
  - check a real .docx without help in under 2 minutes (spec §10);
  - with Wi-Fi off, grammar checking works;
  - Resource Monitor shows no network connections from `writing-check.exe` during a check.
- [ ] **Step 5:** Tag `v1.0.0-private`. Commit: `build: per-user installer and portable zip`

---

## Spec coverage map

| Spec item | Tasks |
|---|---|
| §3.1 input (open/paste/type, Google Docs via download/re-upload) | 7, 9, 11 |
| §3.2 rules pass + hygiene | 2, 3 |
| §3.2 optional LLM pass | 12, 13 |
| §3.3 / §5 tiers, batching, top 5-10, undo, tier settings, drift guard | 5, 6, 11, 13 |
| §5 English variant | 4 |
| §3.4 write back, tracked changes default, save clean, new copy / overwrite+backup | 7, 9, 11 |
| §3.5 presets | 5 |
| §3.6 fact lock | 3, 5, 13 |
| §3.7 change log + report | 6, 11 |
| §3.9 word lookup (offline dictionary) | 11b |
| §3.8 / §9 trust suite | 7 (no-network), 10 |
| §6 constraints (offline, no admin, 8 GB, instant) | 7, 11, 12, 14 |
| §7 signing/staging | 14 (unsigned v1.0, Windows) |
| §10 success metrics | 10, 14 |
