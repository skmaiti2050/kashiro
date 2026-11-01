# English-only labelling (#2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible to read Kashiro's result as "my Hindi/Bengali is fine": say "English proofreading" plainly, set aside paragraphs written mostly in another script (no suggestions, no automatic edits), and mark each one "Not checked".

**Architecture:** The engine already counts such paragraphs (`src/engine/uncheckedScripts.ts`). Task 1 turns that into a per-paragraph list that `prepareCheck` skips entirely; Task 2 shows it in the document, the review panel, the toolbar, Settings and About. The language-engine interface (#2b) is NOT in scope: it is designed with the Hindi engine (#1), per CLAUDE.md ("Don't add a seam until two implementations need it").

**Tech Stack:** TypeScript, React, Vitest (jsdom for tests/dom), harper.js.

**Spec:** GitHub issue #2 (part a) plus owner decisions 2026-11-01: the marker text is "Not checked" (no script or language name: Kashiro does no language detection, and Devanagari also covers Marathi and Nepali); such paragraphs are skipped entirely. Never-damage rules: docs/superpowers/specs/2026-10-20-writing-check-design.md and CLAUDE.md.

## Global Constraints

- Never damage the user's text: a skipped paragraph gets no candidates of any kind, including zero-click hygiene (invisible characters, space runs). Its bytes are written back exactly.
- Which paragraphs count: the existing rule in `uncheckedText` (non-Latin letters outnumber Latin letters, `src/engine/uncheckedScripts.ts:30-37`). Do not change the rule; mixed paragraphs that are mostly English are still checked.
- Romanised Hindi/Bengali (Latin letters, `src/engine/otherLanguage.ts`) is unchanged.
- Every user-facing string in en, hi and bn (`src/ui/i18n/*.json`); list hi/bn drafts in the report.
- Trust baselines: `npm run trust` passes; `decisions.md` md5 `a0a3bdbd73b3211ee5c648ffc7584a84`. If a trust document contains a mostly non-Latin paragraph and its counts change, STOP and report (never edit a baseline).
- Owner's agent rules: Write/Edit only (no sed, heredoc, python, redirection, shell rm); tests first (RED then GREEN); `git commit -F`; no AI attribution; no stash/reset/amend/push/branch switching; one heavy command at a time; no subagents.
- Commit messages `feat(scope): summary`; the last commit's body has `Refs #2` (not Fixes: #2b stays open).

## Review Focus

1. A paragraph that is mostly Hindi with an English typo inside ("मैंने teh किताब पढ़ी, यह बहुत अच्छी थी") gets no suggestion: that is the accepted cost of "skip"; a test pins it.
2. A mostly English paragraph with a Hindi word stays checked as before.
3. A skipped paragraph containing a ZWJ/ZWNJ or a double space: unchanged in the output.
4. The panel count and markers update after an edit turns a paragraph from Hindi to English (or back), through the existing re-check.
5. Screen readers: the marker has an accessible label, and the completion announcement says English-only.

---

### Task 1: Engine: set aside paragraphs in another script

**Files:** `src/engine/uncheckedScripts.ts`, `src/engine/sessionSetup.ts` (`prepareCheck` ~55-93), `src/engine/session.ts` (expose the list), tests in `tests/engine/uncheckedScripts.test.ts` and a session-level test.

- [ ] Step 1: failing tests: `uncheckedText` (or a new sibling) returns the ids of the unchecked paragraphs; a session started on a document with one Hindi, one Bengali and one English paragraph has candidates only in the English one; the Hindi paragraph with "teh", a ZWJ and a double space produces no candidate and its text is written back byte-identical; a mostly English paragraph with a Hindi word is still checked.
- [ ] Step 2: implement: compute the unchecked paragraph ids once in `prepareCheck`, exclude those paragraphs from linting AND from hygiene/zero-click candidate building, and expose them on the session as `otherScriptParagraphs(): readonly number[]` (paragraph ids, document order). Keep `uncheckedText`'s `{paragraphs, mostly}` result working for its current callers (or derive it from the list) so the existing panel and announcement keep behaving.
- [ ] Step 3: `npx tsc --noEmit`, `npm test`, `npm run trust` (one at a time).
- [ ] Step 4: commit `feat(engine): paragraphs in another script are set aside, not checked (#2)`.

### Task 2: UI: "English proofreading" and "Not checked" markers

**Files:** `src/ui/ReviewPanel.tsx` (~187-194, 244), the document view that renders paragraphs (find it from `src/ui/DocumentView.tsx`), `src/ui/Toolbar.tsx` (~135-137), `src/ui/SettingsPanel.tsx` (~90-108), `src/ui/AboutDialog.tsx`, `src/ui/state/sessionController.ts` (~444 announcement), `src/ui/i18n/{en,hi,bn}.json`, `src/ui/app.css`. Tests in tests/dom (calmScreen, language, a new notChecked test).

- [ ] Step 1: failing DOM tests:
  - each skipped paragraph shows a quiet "Not checked" label beside it, with an accessible name ("Not checked: Kashiro proofreads English only");
  - the review panel says how many paragraphs were not checked, with a button that moves to the next one (wraps); the existing "mostly" case still replaces the all-clear line;
  - the toolbar chip reads "English proofreading" (a tooltip or visible text — keep the chip compact; check it fits at the narrow window width the app supports);
  - Settings › Language hint and About each state that proofreading is English only;
  - hi and bn render their own strings.
- [ ] Step 2: implement with the existing styling tokens (muted text like other secondary labels; no new colours). Strings (en): marker "Not checked"; marker label "Not checked: Kashiro proofreads English only"; panel "{count} paragraphs aren't in English and were not checked." / singular; button "Show next"; toolbar "English proofreading"; About line "Kashiro proofreads English. Text in other scripts is shown but not checked." Rewrite `panel.englishOnly` and `language.hint` to match. hi/bn drafts in the report.
- [ ] Step 3: `npx tsc --noEmit`, `npm test`.
- [ ] Step 4: commit `feat(ui): say "English proofreading" and mark paragraphs that were not checked (#2)`, body `Refs #2`.
