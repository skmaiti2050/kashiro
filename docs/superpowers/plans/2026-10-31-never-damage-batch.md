# Never-damage batch (v1.0.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six never-damage issues testers can hit in v1.0 (GitHub #7, #8, #9, #11, #34, #35), each with a test that failed first.

**Architecture:** Small, local fixes in the engine (`src/engine`) and the UI state (`src/ui/state`). No new modules unless a task says so; no format change except the saved-review snapshot in Task 4.

**Tech Stack:** TypeScript, Vitest (jsdom for `tests/dom`), harper.js.

**Spec:** the GitHub issues are the spec: https://github.com/skmaiti2050/kashiro/issues/7, /8, /9, /11, /34, /35 (text copied into each task). The binding design is `docs/superpowers/specs/2026-10-20-writing-check-design.md` (never-damage rules) and `CLAUDE.md`.

## Global Constraints

- Never damage the user's text: when unsure, skip the edit and report it; never write it half-way (CLAUDE.md §1).
- Every fix gets a test that failed before the fix (RED, then GREEN), named in the report.
- Trust baselines must hold: `npm run trust` 79/79, reference ticks 8 / corpus ticks 10, zero-click count 41, `decisions.md` md5 `a0a3bdbd73b3211ee5c648ffc7584a84`. A change to any of these is a finding to report, never to "fix" by editing the baseline.
- New user-facing strings in en, hi and bn (`src/ui/i18n/*.json`); list the hi/bn drafts in the report.
- Owner's rules for agents: Write/Edit tools only for files (no sed, heredoc, python, or shell redirection to write files); `git commit -F <file>`; no `Co-Authored-By` or AI attribution; no `git stash`, `reset`, `rm`, worktrees or pushes; one heavy command (npm test, trust, build) at a time.
- Commit messages `fix(scope): summary`, one commit per task (fix rounds may add commits).
- Files already over ~300 lines (`session.ts` 645, `sessionController.ts` 769): add only what the fix needs, and say so in the report; don't split them here (issue #33).

## Review Focus

1. A fix that skips one bad edit must not also suppress correct suggestions elsewhere in the paragraph (recall): check neighbouring flags still appear.
2. Markdown `[label]` locking must not lock ordinary prose in brackets so widely that real typos inside long bracketed asides vanish without notice; keep the lock to label-sized spans.
3. Key-value spacing: a real prose sentence with an accidental double space after a colon ("Note:  this is wrong.") is the boundary; decide it explicitly in a test.
4. Resume of an older saved review (snapshot version 3) must still load after Task 4.
5. A notice must appear exactly once per lost click, not on every later re-check.

---

### Task 1: Key-value spacing survives the multi-space collapse (#8)

Issue: In "Name:      Rahul\nPhone: …", or a lone "Address:  12 MG Road.", the multi-space collapse changes the aligned spacing. The short-key rule ignores the punctuation before the gap. Acceptance: these forms keep their spacing, with tests.

**Files:** Modify `src/engine/zeroClick.ts` (`SHORT_KEY_THEN_GAP` line 38, `isShortKeyValueLine` 51-53, `COLUMN_GAP` 20, `WIDE_GAP` 36). Test: `tests/engine/zeroClick.test.ts`.

- [ ] Step 1: failing tests: "Name:      Rahul\nPhone: 98200 00000" keeps both gaps; "Address:  12 MG Road." (a whole paragraph) keeps its two spaces; "Note:  this is wrong." **Ruling:** a key of one to three words ending in ':' followed by 2+ spaces is a key-value form even when the value ends with a full stop, so this one also keeps its gap (whitespace only; skipping is the safe side). A two-space gap in a sentence without a colon key ("This is  wrong.") still collapses.
- [ ] Step 2: run `npx vitest run tests/engine/zeroClick.test.ts`, expect the new tests to FAIL.
- [ ] Step 3: let a short key ending in ':' followed by a gap count as a key-value line regardless of the sentence-final full stop. One named regex with an example comment.
- [ ] Step 4: tests pass; then `npm test`, then `npm run trust` (report the zero-click count: it may drop below 41 only if a trust document has such a key; report which).
- [ ] Step 5: commit `fix(engine): key-value lines keep their spacing (#8)`.

### Task 2: Legitimately doubled keywords stay unticked and untouched (#7)

Issue: Keywords that are legitimately doubled are treated as repeated words, for example "open files with with" in a how-to, or `[the the]` reference links in Markdown. Direction: recognise these forms (reference-link labels, quoted keywords) as fact-locked spans so the repeated-word tick does not apply. Acceptance: both examples stay unticked and untouched, with regression tests.

**Files:** `src/engine/factLock.ts` (`findLockedSpans` 188, PATTERNS 10-55), `src/engine/defaultTicks.ts` (`startsTicked` 35-41). Tests: `tests/engine/factLock.test.ts`, `tests/engine/defaultTicks.test.ts`.

- [ ] Step 1: reproduce first, in a test through the session: Markdown "See [the the] for details.\n\n[the the]: https://example.com" and the how-to forms `Open files with "with with".` and ``Open files with `with with`.``, plus the bare "To open files, use the keyword with with the path." Record which already pass.
- [ ] Step 2: **Ruling:** lock Markdown reference-link labels: a `[...]` of 1–40 characters with no nested brackets that is followed by `[`, `(`, or `:` (a link or a definition), or that matches a defined label in the same document. Bare unbracketed prose like "with with" cannot be told apart from a slip; it stays a suggestion but must not start ticked unless `isClearProseSentence` holds (check that it does not for the how-to fragment; if it does, report it, don't widen the rule).
- [ ] Step 3: implement the lock as one named pattern in PATTERNS with an example comment; check `startsTicked` respects locked spans (the map notes it may not consult them). Doubled words inside quotes/backticks must not be offered at all.
- [ ] Step 4: tests pass; `npm test`; `npm run trust` (ticks 8/10 must hold).
- [ ] Step 5: commit `fix(engine): reference-link labels and quoted keywords are not repeated words (#7)`.

### Task 3: A restored invisible character stays restored (#9)

Issue: If the user undoes an invisible-character removal and later accepts a card covering the same spot, the character is deleted again. Direction: record restored invisible characters per position so later passes skip them. Acceptance: undo, then accept a neighbouring card; the restored character stays.

**Files:** `src/engine/session.ts` (`undo` 500-516, `autoApply` 589-598), `src/engine/sessionSetup.ts` (`inParagraph` 33-37, `withoutFixOverKept` 44), `src/engine/editLedger.ts`. Test: `tests/engine/session.test.ts` (describe 'invisible characters (review #4, C3)').

- [ ] Step 1: failing test: a paragraph with a zero-width space inside a misspelt word ("recie​ved"); undo the auto removal; accept the spelling card; the paragraph text still contains the U+200B where the user restored it (the spelling fix applies around it, or, if that can't be placed safely, the card is reported unplaceable and nothing changes). Also: accepting a card that does not cover the character leaves it alone.
- [ ] Step 2: **Ruling:** treat a user-undone invisible-character removal as "kept", the same way `withoutFixOverKept` treats characters hygiene keeps; the replacement is rebuilt against the real text or the fix is skipped. Never delete the character.
- [ ] Step 3: implement; tests pass; `npm test`; `npm run trust`.
- [ ] Step 4: commit `fix(engine): a restored invisible character is not deleted by a later fix (#9)`.

### Task 4: Fixes accepted under an AI rewrite are kept (#11)

Issue: (a) Adding a word to the dictionary after the rewrite drops the rewrite and the fix at the next re-check. A plain accepted fix is taken back at once, in the log; one under a rewrite is left alone. (b) A saved review does not record a fix accepted under an AI rewrite, so it comes back pending on resume. Direction: store accepted fixes under a rewrite in the saved review, and take them back with the same log entry as a plain fix. Acceptance: both cases keep the fix (or clearly restore it), with resume and re-check tests.

**Files:** `src/engine/session.ts` (`addWord` 474-487, esp. 482-483), `src/engine/carryDecisions.ts` (`userDecisions` 40-53), `src/engine/sessionSnapshot.ts` (`snapshot` 62-86, filter line 75, `restore` 93-114, `SNAPSHOT_VERSION` 10). Tests: `tests/engine/dictionaryWords.test.ts`, `tests/engine/ruleFixUnderEdit.test.ts`, `tests/engine/sessionSnapshot.test.ts`.

- [ ] Step 1: failing tests: (a) accept a spelling fix, apply an AI rewrite over that paragraph, add an unrelated flagged word from the same paragraph to the dictionary, re-check: the rewrite is still applied and the earlier fix is still accepted (not pending, not lost). Adding the *fixed* word itself takes the fix back with the same "added to dictionary" log entry as a plain fix, and the rewrite is withdrawn only if it can no longer be placed, with its own notice. (b) snapshot then restore a session where a fix was accepted under a rewrite: on resume the fix is applied (the rewrite is not saved, so the fix applies as a plain accepted fix), not pending.
- [ ] Step 2: **Rulings:** never record 'added to dictionary' over a superseded candidate the user did not add; saved decisions under a rewrite are written without the rewrite and replayed as plain accepted fixes. Bump `SNAPSHOT_VERSION` to 4 only if the stored shape changes; a version-3 snapshot must still restore (test it).
- [ ] Step 3: implement; tests pass; `npm test`; `npm run trust`.
- [ ] Step 4: commit `fix(engine): fixes accepted under an AI rewrite survive dictionary adds and resume (#11)`.

### Task 5: Apply during the typing pause is never silently lost (#34)

Issue: If the user presses Apply during the typing pause and the paragraph has changed, the click is silently lost. Direction: show a message, or disable the card openers while a check is pending. Acceptance: the user always sees either the applied fix or an explanation, with a test.

**Files:** `src/ui/state/sessionController.ts` (`editText` 373-378, `check` 405-454, `act` 671-688, `accept` 464, `applyBatch` 492), `src/engine/carryDecisions.ts` (137-139). Tests: `tests/ui/sessionController.test.ts`, `tests/dom/batchPreviewRecheck.test.tsx`.

- [ ] Step 1: failing test: type into a paragraph, then accept a card in that paragraph before the 300 ms re-check runs; after the re-check either the fix is applied or `state.notice` is the new message; it appears once (a later re-check does not repeat it). Same for a batch apply.
- [ ] Step 2: **Ruling (controller):** show a message, don't disable: disabling would flicker the cards on every keystroke. `carryDecisions` reports the applied decisions it dropped because their paragraph changed; the controller shows `notice.applyLostToTyping`: en "That fix wasn’t applied: the paragraph changed while you were typing. Check the updated suggestion." plus hi/bn drafts. Decisions on unchanged paragraphs carry as today.
- [ ] Step 3: implement; tests pass; `npm test`.
- [ ] Step 4: commit `fix(ui): an Apply lost to typing says so (#34)`.

### Task 6: An edit made unplaceable by a save closes its preview (#35)

Issue: Unreproduced. When an edit is marked unplaceable during a save, open previews for it may stay open. Direction: reproduce it first, then close or refresh any preview whose edit becomes unplaceable. Acceptance: a reproduction test, then a fix.

**Files:** `src/ui/state/saveFlow.ts` (`saveDocument` 81-100, `markUnplaceable` loop 83-89), `src/ui/state/saveActions.ts` (61-62), `src/ui/useOpenPreview.ts` (36), `src/engine/session.ts` (`markUnplaceable` 579-585). Tests: `tests/dom/batchPreviewRecheck.test.tsx` or a new `tests/dom/savePreview.test.tsx`.

- [ ] Step 1: reproduction test: open a batch or card preview, save while one of its edits cannot be placed in the file (use the existing unplaceable fixtures in the save tests), and assert the preview closes (or shows the refreshed state). Expect FAIL: nothing bumps `textChanges` after `markUnplaceable`.
- [ ] Step 2: **Ruling:** route the save's unplaceable marking through the controller's change signal (bump `textChanges` when the save marked anything), so every open preview refreshes by the existing rule; no new preview logic. If the test cannot reproduce it, report that with what was tried and stop (the issue stays open).
- [ ] Step 3: implement; tests pass; `npm test`.
- [ ] Step 4: commit `fix(ui): previews close when a save makes their edit unplaceable (#35)`.
