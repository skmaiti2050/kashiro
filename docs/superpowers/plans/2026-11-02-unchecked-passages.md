# Unchecked passages (#29) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Never let a result claim more than was checked: mark text inside checked paragraphs that Kashiro did not really check (words in another script, sentences in another Latin-script language), count it in the panel, and say "Nothing to check" for a document with no English words.

**Architecture:** Builds on #2a (v1.1.0: paragraphs mostly in another script are set aside, `session.otherScriptParagraphs()`, the "Not checked" block marker, the panel count line with "Show next"). Task 1 adds an engine list of unchecked passages inside checked paragraphs; Task 2 shows them as a quiet dotted underline, folds them into the panel count, and adds the two new headings. The engine's checking of English text is unchanged: passages are only reported, never removed from the check.

**Tech Stack:** TypeScript, React, CodeMirror 6 decorations, Vitest (jsdom for tests/dom).

**Spec:** GitHub issue #29 + owner decisions 2026-11-02:
- any other-script word counts (a single word like "नमस्ते" in an English sentence is a passage);
- mark with an underline, not by blocking the engine;
- sentences already detected as another language (`findForeignSentences`, Latin script, e.g. "C'est la vie, mon ami.") are marked the same way;
- names and honorifics (José, Müller, Señor, Shri, "ji") are NOT passages: they stay on their existing cards.
Panel wording (owner-approved table, 2026-11-02): see Task 2.

## Global Constraints

- Never damage the user's text: marking is display only. No candidate is added, removed, ticked or unticked by this feature; the document text, offsets, copy and saved file never contain markup. Trust baselines must hold (`npm run trust` passes; `deps/reports/decisions.md` md5 `a0a3bdbd73b3211ee5c648ffc7584a84`); if they change, STOP and report.
- "Other-script word": a run of letters (`\p{L}` plus their marks/joiners, like `otherLanguage.ts`'s `WORD`) whose letters are not Latin (and not Common/Inherited). Emoji, digits, punctuation and symbols are never passages. Adjacent other-script words separated only by spaces/punctuation form ONE passage (a Hindi phrase is one passage, not five).
- Paragraphs already set aside (#2a) are not scanned for passages (their block marker covers them).
- Foreign sentences: reuse `findForeignSentences` spans as they are; do not change its threshold.
- Every new string in en, hi and bn (`src/ui/i18n/*.json`); list hi/bn drafts.
- Owner's agent rules: Write/Edit only (no sed, heredoc, python, redirection, shell rm); tests first (RED then GREEN); `npx tsc --noEmit`, `npm test` (name any failing file), `npm run trust` when src/engine changes; `git commit -F`; no AI attribution; no stash/reset/amend/push/branch switching; one heavy command at a time; no subagents.
- Last commit body: `Fixes #29`.

## Review Focus

1. "She said नमस्ते and left." — one passage; the English words around it still get their normal flags.
2. A Hindi phrase of several words inside an English paragraph is one passage, not one per word.
3. "José met Müller." — no passage (Latin script with diacritics).
4. A document of only emoji (and spaces/newlines) → "Nothing to check" heading, not "All clear"; a document of only digits/punctuation too.
5. After an edit removes the other-script word, the re-check removes its underline and the count drops.

---

### Task 1: Engine: list unchecked passages

**Files:** `src/engine/uncheckedScripts.ts` (script scan), `src/engine/otherLanguage.ts` (`findForeignSentences`, read only), `src/engine/sessionSetup.ts` / `src/engine/session.ts` (expose), tests in `tests/engine/uncheckedScripts.test.ts` and a session-level test.

- [ ] Step 1: failing tests:
  - `otherScriptPassages(text)` (or similar) returns spans: "She said नमस्ते and left." → one span covering "नमस्ते"; "We read रामायण और महाभारत yesterday." → ONE span from "रामायण" to "महाभारत"; "José met Müller." → none; "🎉🎉 2024!" → none; Bengali and Tamil words → spans.
  - session level: a document with an English paragraph containing "नमस्ते" and the sentence "C'est la vie, mon ami." exposes `uncheckedPassages()` → `{paraId, span, kind: 'otherScript' | 'otherLanguage'}[]` in document order; the English typos in that paragraph still have their candidates (same as before this change); a set-aside paragraph (#2a) contributes no passages.
  - `hasEnglishText()` (or a checked-word count) is false for an emoji-only document and for a digits/punctuation-only one, true for any document with a Latin word in a checked paragraph.
- [ ] Step 2: implement with one named regex constant (example comment, no catastrophic backtracking) and expose on the session; reuse the foreign-sentence spans already computed during setup (do not run the classifier again).
- [ ] Step 3: `npx tsc --noEmit`, `npm test`, `npm run trust` (one at a time).
- [ ] Step 4: commit `feat(engine): list passages that were not checked inside English paragraphs (#29)`.

### Task 2: UI: dotted underline, panel wording, "Nothing to check"

**Files:** `src/ui/DocumentView.tsx` (decorations, next to the #2a block marker), `src/ui/ReviewPanel.tsx` (heading + count line + Show next), `src/ui/app.css`, `src/ui/i18n/{en,hi,bn}.json`, tests in `tests/dom/notChecked.test.tsx`, `tests/dom/calmScreen.test.tsx`.

- [ ] Step 1: failing DOM tests:
  - each passage has a quiet dotted grey underline (a CodeMirror mark decoration with class `cm-not-checked-passage`, existing muted colour token; clearly unlike the wavy error underline) and a `title` "Not checked: Kashiro proofreads English only"; the mark is not part of the text, copy or save;
  - panel heading, when nothing is pending and something was skipped (passages or set-aside paragraphs): **"All clear in the English text"** instead of "All clear";
  - panel count line: passages only → "{count} passage(s) isn't/aren't in English and was/were not checked." ; paragraphs and passages → "{paragraphs} paragraph(s) and {passages} passage(s) aren't in English and were not checked." ; paragraphs only → the existing #2a line; "Show next" steps through paragraphs and passages in document order and wraps;
  - emoji-only / no English words → heading **"Nothing to check: no English words"**, no count line, no "Show next";
  - the mostly-other-script case (#2a `panel.englishOnly` heading) is unchanged;
  - hi and bn render their own strings.
- [ ] Step 2: implement (decorations rebuilt from session state like the #2a marker; Show next reuses `paragraphStart`/the existing scroll; screen readers get the information from the panel line and the completion announcement, as in #2a — the underline itself needs no ARIA).
- [ ] Step 3: `npx tsc --noEmit`, `npm test`.
- [ ] Step 4: commit `feat(ui): underline passages that were not checked; never claim more than was checked (#29)`, body `Fixes #29`.
