# Hindi gates 1–8 (#1 prep) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app safe and truthful for a document that a non-English engine proofreads, before any Hindi engine exists. These are the engine-independent gates 1–8 from the #2b review.

**Architecture:** Two engine tasks and two UI tasks. Every test drives a **fake** Devanagari engine through the existing seam (`SessionDeps.scriptEngines`), like `tests/engine/languageEngine.test.ts` does. No Hindi rules, dictionary or segmentation are added here: that is gate 9 and #1 proper.

**Tech Stack:** TypeScript, React, Vitest (unit + dom projects).

**Spec:** The gate list in `.superpowers/sdd/2026-11-02-language-engine/progress.md` (lines 23–32), issue #1, and `CLAUDE.md`.

## Global Constraints

- **Never damage the user's text.** Until gate 9 sets a Hindi tier policy, nothing from a paragraph that a non-English engine checks is applied without a click.
- English documents behave exactly as today. Every existing test passes unchanged, except the renames named in a task.
- One proofreading engine per document (owner, 2026-11-02). Tasks never route paragraphs differently.
- `src/engine` never imports `src/ui` (enforced by `tests/engine/layering.test.ts`). The engine names no UI key.
- The Hindi and Bengali catalogue strings are drafts. They go to the native-review list (#4), not to a translator now.
- Commit messages: `type(scope): summary`. No `Co-Authored-By` or AI attribution.
- Test tiers:
  - `npm run test:changed` per commit;
  - `npm run test:engine` + `npm run trust` before an engine task's review;
  - `npm run test:ui` + `npm run test:dom` before a UI task's review;
  - `npm run test:release` + `trust` + `upgrade:check` before release.
- If DOM tests flake under full-suite load, rerun the failing files alone, then the full suite.

## Review Focus

1. **A whitespace or invisible-character fix inside a Hindi paragraph.** It is a zero-click change in English. Here it must stay a card and never auto-apply. Task 1 pins this.
2. **A Hindi document checked by the Hindi engine** must not say "Kashiro proofreads English", "aren't in English" or "Nothing to check: no English words". Tasks 2 and 3 pin this.
3. **A mostly-English document with a few Hindi paragraphs** keeps today's wording and counts exactly. Every task's English regression checks cover this; Task 3 adds one DOM assertion.
4. **The Hindi document's English variant controls:**
   - The toolbar picker and the status-bar "American English (detected)" mean nothing there, so they are hidden.
   - English documents keep them.
   - Task 4 pins this.
5. **Read aloud on Hindi text:**
   - Hindi text must use a Hindi voice, and is never read by an English voice, which garbles it.
   - With no Hindi voice, nothing is read.
   - Task 4 pins this.

---

### Task 1: Never-damage for non-English engines (gate 1)

**Files:**
- Create: `src/engine/lockedText.ts`
- Modify:
  - `src/engine/englishEngine.ts:96-102`: `checkEnglish` builds its locks through the new function, a verbatim move.
  - `src/engine/sessionSetup.ts`: lock every other engine's paragraphs too.
  - `src/engine/tiers.ts`: the cap.
  - `src/engine/tiers.ts` `TierContext`: one new field.
- Test: `tests/engine/nonEnglishSafety.test.ts` (new)

**Interfaces:**
- Produces:
  - `findLockedText(paras: readonly Paragraph[], language: CheckOptions['language']): { locked: Map<number, Span[]>; commands: CommandText }`
    - `locked` is exactly what `checkEnglish` builds today: `findLockedSpans`, the surely-command spans and `p.locked`.
    - `commands` is `findCommandText`'s result.
  - `TierContext.englishParagraphs?: ReadonlySet<number>`: the ids English checked. When it is set, `tierOf` caps any candidate on another paragraph at `'review'`, so a `'safe'` result becomes `'review'`. `'hidden'` stays hidden.

- [ ] **Step 1: Write the failing tests** in `tests/engine/nonEnglishSafety.test.ts`. The fake Devanagari engine (copy the shape of `fakeDevanagari` in `languageEngine.test.ts`) returns the given candidates, and the document is `MOSTLY_HINDI` from that file.
  - `a whitespace fix in a Hindi paragraph is never applied without a click`:
    - The candidate is `kind: 'Formatting'`, `source: 'rules'`, `original: '  '` → `replacements: [' ']` between two Devanagari words.
    - Expect `session.tier(id) === 'review'` and `outcomes()` status `'pending'` with `auto: false`.
  - `an invisible-character fix in a Hindi paragraph is never applied without a click`: the same assertions for `source: 'hygiene'`, deleting a U+200B placed between two Devanagari words.
  - `a fix over a URL in a Hindi paragraph touches locked text`:
    - The paragraph contains `https://example.com`, and the candidate's span overlaps it.
    - Expect `session.touchesLocked(id) === true`.
  - `a fix over an adapter-locked span in a Hindi paragraph touches locked text`: the paragraph has `locked: [span]` and the candidate overlaps it. Expect `touchesLocked(id) === true` and `tier === 'review'`.
  - `English paragraphs keep zero-click fixes`: the same double-space fix in an English-only document, with no fake engine, is still `'safe'` and auto-applied. This is the regression guard.
- [ ] **Step 2: Run** `npx vitest run tests/engine/nonEnglishSafety.test.ts`. Expected: the first four FAIL (today the fix auto-applies and `touchesLocked` is false); the last PASSES.
- [ ] **Step 3: Implement.**
  - Create `findLockedText`, and make `checkEnglish` call it, a verbatim move of lines 96-102.
  - In `prepareCheck`, for the paragraphs whose engine is not English, merge `findLockedText(thoseParas, opts.language).locked` into the returned context's `locked`.
  - Set `englishParagraphs` to the ids routed to English.
  - Add the cap as the first check after `tierOf`'s hidden rules: before `override`, so no user override lifts it. Comment it with `// #1 gate 1: no zero-click outside English until a Hindi tier policy (gate 9)`.
- [ ] **Step 4: Run** the new file, then `npm run test:engine` and `npm run trust`. Expected: all green, with the English counts unchanged.
- [ ] **Step 5: Commit** `fix(engine): lock and never auto-apply in paragraphs another engine checks (#1 gate 1)`.

---

### Task 2: Passages and "checked text" follow the proofreading engine (gates 3–4, engine side of gate 2)

**Files:**
- Modify:
  - `src/engine/sessionSetup.ts`: return the proofreader's script.
  - `src/engine/uncheckedScripts.ts`
  - `src/engine/session.ts` (`start`, `hasEnglishText`)
  - `src/ui/ReviewPanel.tsx` and `src/ui/state/sessionController.ts`: the call sites of the rename only.
- Test: `tests/engine/otherScriptSession.test.ts` (extend) and `tests/engine/languageEngine.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's routing is unchanged.
- Produces:
  - `prepareCheck(...)` also returns `proofreaderScript: string`. It is `'Latin'` for English, else the `scriptEngines` key that won `majorityScript`.
  - In `uncheckedScripts.ts`:
    - `otherScriptPassages(text: string, ownScript = 'Latin'): Span[]` gives runs of letters outside `ownScript` (Common/Inherited never count). With the default, it behaves exactly as today. Build the regex once per script and cache it in a `Map`.
    - `uncheckedPassages(paras, setAside, foreignSentences, ownScript = 'Latin')` passes `ownScript` through. Foreign-language sentences come only from English, so for any other script `foreignSentences` is an empty map.
    - `hasLetterOf(text: string, script: string): boolean`, where `hasLatinLetter(text)` equals `hasLetterOf(text, 'Latin')`.
    - `mostlyNotChecked(paras: readonly Paragraph[], setAside: ReadonlySet<number>): boolean` is true when the set-aside paragraphs hold more letters (`\p{L}`) than the rest.
  - `CheckSession`:
    - `hasEnglishText()` is **renamed** `hasCheckedText(): boolean`. It is true when a paragraph the proofreader checked has a letter of its script, so English keeps today's rule (a Latin letter). Doc comment: "False when the checked paragraphs hold no letter of the proofread script: nothing was checked."
    - New `mostlyNotChecked(): boolean` uses the set-aside paragraphs (`otherScriptParagraphs()`).

- [ ] **Step 1: Write the failing tests.**
  - In `languageEngine.test.ts`, with the fake Devanagari engine on `MOSTLY_HINDI`:
    - `a Hindi document checked by the Hindi engine has checked text`: `hasCheckedText() === true`.
    - `Latin words inside a checked Hindi paragraph are a not-checked passage`:
      - The paragraph is `'यह Kashiro का परीक्षण है'`.
      - Expect one `uncheckedPassages()` entry with `kind: 'otherScript'` and `span` over `Kashiro`.
    - `a Hindi document with one English paragraph is not mostly unchecked`: `mostlyNotChecked() === false`.
  - In `otherScriptSession.test.ts`, without an engine: a document of three Hindi paragraphs and one English paragraph gives `mostlyNotChecked() === true`, and an English document gives `false`. These pin today's English behaviour.
  - Rename every `hasEnglishText` in tests to `hasCheckedText`. The assertions don't change.
- [ ] **Step 2: Run** the two files. Expected: the new Hindi tests FAIL (Devanagari counts as "other script" today); the English ones PASS.
- [ ] **Step 3: Implement** to the Interfaces above. In `start()`, the set-aside set stays "engine id is not the proofreader's", generalising `!== 'en'`. Passages and checked text use `proofreaderScript`. Update the two UI call sites to the new name, behaviour unchanged (Task 3 rewires them).
- [ ] **Step 4: Run** `npm run test:engine`, `npm run trust` and `npm run test:changed`. Expected: green.
- [ ] **Step 5: Commit** `feat(engine): passages and checked text follow the proofreading engine's script (#1 gates 3-4)`.

---

### Task 3: Wording follows the proofreading engine (gates 2, 3, 7, 8)

**Files:**
- Create: `src/engine/scriptEngines.ts`
- Modify:
  - `src/engine/languageEngine.ts`: `EngineId`.
  - `src/ui/proofreadingLabels.ts`: the `hi` row.
  - `src/ui/i18n/en.json`, `hi.json`, `bn.json`
  - `src/ui/ReviewPanel.tsx:194-215`
  - `src/ui/state/sessionController.ts`: `ControllerDeps` and the announcement at ~449-457.
  - `cli/run.ts:119`
  - `tests/dom/harness.ts`: `makeController` passes `scriptEngines` through.
- Test: `tests/dom/hindiProofreading.test.tsx` (new), `tests/ui/proofreadingLabels.test.ts` or the existing DOM labels test (extend)

**Interfaces:**
- Consumes: `hasCheckedText()` and `mostlyNotChecked()` (Task 2).
- Produces:
  - `EngineId = 'en' | 'hi' | 'none'`.
  - `createScriptEngines(): Map<string, LanguageEngine>` in `src/engine/scriptEngines.ts`. It returns an empty map. Doc comment: "The one place a language engine is registered, by Unicode script name; #1 adds 'Devanagari' here."
  - `ControllerDeps.scriptEngines?: ReadonlyMap<string, LanguageEngine>`, defaulting to `createScriptEngines()` and passed to `CheckSession.start`. `cli/run.ts` passes `{ scriptEngines: createScriptEngines() }`.
  - `PROOFREADING_LABELS.hi` uses the new keys below. `proofreadingLabels` is unchanged.

New catalogue keys:
- **English copy** is exact.
- **`hi.json` and `bn.json`:** take the English row's existing translation of the matching key and replace the language name. For Hindi, अंग्रेज़ी becomes हिंदी. For Bengali, ইংরেজি becomes হিন্দি. Fix grammar if the swap breaks it, and add every new key to the #4 review list in the task report.

| Field | Key | English |
|---|---|---|
| chip | `toolbar.hindi` | Hindi proofreading |
| only | `panel.hindiOnly` | Kashiro proofreads Hindi in this document. Text in other scripts is shown but not checked. |
| about | `about.hindiOnly` | (same as `panel.hindiOnly`) |
| hint | `language.hintHindi` | The language of the app’s menus and messages. Kashiro proofreads Hindi in this document. Text in other scripts is shown but not checked. |
| allClear | `panel.allClearHindi` | All clear in the Hindi text |
| otherParagraphs | `panel.otherScriptHindi` | `{count, plural, one {# paragraph isn't in Hindi and was not checked.} other {# paragraphs aren't in Hindi and were not checked.}}` |
| otherPassages | `panel.passagesHindi` | `{count, plural, one {# passage isn't in Hindi and was not checked.} other {# passages aren't in Hindi and were not checked.}}` |
| otherBoth | `panel.paragraphsAndPassagesHindi` | `{paragraphs, plural, one {# paragraph} other {# paragraphs}} and {passages, plural, one {# passage} other {# passages}} aren't in Hindi and were not checked.` |
| announceOnly | `announce.checkedHindiOnly` | `Check finished: {count, plural, =0 {nothing to decide} one {# suggestion to decide} other {# suggestions to decide}}. Kashiro proofreads Hindi in this document. Text in other scripts was not checked.` |
| announcePassages | `announce.checkedPassagesHindi` | `Check finished: {count, plural, =0 {nothing to decide} one {# suggestion to decide} other {# suggestions to decide}}. Some text isn't in Hindi and was not checked.` |

- [ ] **Step 1: Write the failing DOM tests** in `tests/dom/hindiProofreading.test.tsx`. Build the controller with `makeController({ scriptEngines: new Map([['Devanagari', fakeHindi]]) })`, where `fakeHindi` has `capabilities.id: 'hi'` and returns no candidates. Open a three-paragraph Hindi text with one English paragraph.
  - `the panel names Hindi`:
    - `All clear in the Hindi text` and `1 paragraph isn't in Hindi and was not checked.` are shown.
    - `Kashiro proofreads English. Text in other scripts is shown but not checked.` is absent, and so is `Nothing to check: no English words`.
  - `the toolbar chip says Hindi proofreading`.
  - `the completion announcement names Hindi`: the live region contains `Kashiro proofreads Hindi in this document.` or `isn't in Hindi`. Pick whichever branch the document reaches, and assert it exactly.
  - `an English document with one Hindi paragraph keeps today's wording`: no fake engine; `1 paragraph isn't in English and was not checked.`
  - `both composition roots use the registry`. This is a unit test in `tests/ui/`: spy on `createScriptEngines` and check that the controller calls it when `deps.scriptEngines` is unset.
- [ ] **Step 2: Run** the new file. Expected: FAIL (no `hi` row yet; `mostly` is computed from `uncheckedText`).
- [ ] **Step 3: Implement.**
  - `doneLine`'s first condition uses `session.mostlyNotChecked()`, and the `nothingToCheck` branch uses `!session.hasCheckedText()`.
  - Remove the `uncheckedText` import, and remove `uncheckedText` itself from `uncheckedScripts.ts` if nothing else uses it.
  - The controller's announcement uses `hasCheckedText()`.
  - Add the `hi` row and the catalogue keys, the registry, and the deps wiring.
- [ ] **Step 4: Run** `npm run test:ui`, `npm run test:dom` and `npm run test:changed`. Expected: green, including the i18n key-parity tests.
- [ ] **Step 5: Commit** `feat(ui): name the proofreading language from the engine, and register script engines in one place (#1 gates 2, 3, 7, 8)`.

---

### Task 4: English-only controls and read-aloud language (gates 5–6)

**Files:**
- Modify:
  - `src/ui/proofreadingLabels.ts`: one helper.
  - `src/ui/Toolbar.tsx`: the variant select at ~123-150.
  - `src/ui/StatusBar.tsx:36`
  - `src/ui/state/readAloud.ts`
  - `src/ui/ReviewPanel.tsx:250-252`
  - `src/engine/sessionTypes.ts`: a `CheckOptions` doc only.
- Test: `tests/ui/readAloud.test.ts` (extend) and `tests/dom/hindiProofreading.test.tsx` (extend)

**Interfaces:**
- Consumes: the `fakeHindi` set-up from Task 3's test file.
- Produces:
  - `proofreadsEnglish(session: CheckSession | null): boolean` in `proofreadingLabels.ts`. It is true before a check, and when `proofreadingEngines()[0]?.id` is `'en'` or there is no engine.
  - `textLanguage(text: string): 'en' | 'hi' | 'bn'` in `readAloud.ts`. It returns `'hi'` or `'bn'` when `dominantScript(text, ['Devanagari', 'Bengali'])` (from `@/engine/uncheckedScripts`) returns that script, and `'en'` otherwise.

- [ ] **Step 1: Write the failing tests.**
  - In `readAloud.test.ts`:
    - `textLanguage('यह एक वाक्य है।') === 'hi'`
    - `textLanguage('এটি একটি বাক্য।') === 'bn'`
    - `textLanguage('This is a sentence.') === 'en'`
    - `textLanguage('Kashiro का परीक्षण') === 'hi'`, because there are more Devanagari letters than Latin.
    - `textLanguage('') === 'en'`
  - In the DOM file:
    - `a Hindi-proofread document hides the English variant picker and the status-bar variant`. Query the select by its accessible name as the existing toolbar tests do, and the status text `/English \(/`. Both are absent.
    - `an English document still shows them`.
    - `Read sentence on Hindi text asks for a Hindi voice`. Spy on the read-aloud `speak` call the existing `readAloudControls.test.tsx` uses, put the caret in the Hindi paragraph, and expect the language to be `'hi'`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The toolbar and status bar render the variant only when `proofreadsEnglish(session)`.
  - In `ReviewPanel`, the sentence and paragraph targets use `textLanguage(text)` in place of `'en'`. Card text keeps its current rule.
  - In `CheckOptions`, add the doc line: `variant` and `fallbackVariant` are English's and are read only by the English engine. Each engine reads only its own options (#1).
- [ ] **Step 4: Run** `npm run test:ui`, `npm run test:dom` and `npm run test:changed`. Expected: green.
- [ ] **Step 5: Commit** `feat(ui): hide English-only controls and read text in its own language (#1 gates 5-6)`.

---

### After the tasks (controller)

- [ ] Final whole-branch review, then `/simplify`, then `test:release`, `trust` and `upgrade:check`.
- [ ] Update the gate list in `.superpowers/sdd/2026-11-02-language-engine/progress.md` to mark 1–8 done with commits. Comment on #1 with what is ready and what remains (gate 9 + rules).
- [ ] Release is the owner's call (see the handoff note): push `v1.0-dev` only, until the owner decides.
