# Hindi prep batch (#1, part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four #1 follow-ups that need no capabilities redesign: the danda in zero-click line shapes, no edit that splits a character, an AI helper that reads only checked English, and read aloud that follows the caret and names the missing voice.

**Architecture:** Two engine guards (`zeroClick.ts`, a new `graphemes.ts` checked at candidate intake), one selection rule in `llm/select.ts`, and a UI change that reports the caret's languages from the editor to the read-aloud bar. No interface of `CheckSession` changes.

**Tech Stack:** TypeScript, React, CodeMirror 6, Vitest (+ Testing Library for `tests/dom`), `Intl.Segmenter`, `Intl.DisplayNames`.

**Spec:** the #1 follow-up list at the end of `.superpowers/sdd/2026-11-02-language-engine/progress.md` (lines 39-46) and the Task 3/4 parked items in `.superpowers/sdd/2026-11-04-hindi-gates/progress.md` (lines 30, 41, 55). Coding rules: `CLAUDE.md`.

## Global Constraints

- Never damage the user's text: when unsure, skip the edit and report it (CLAUDE.md §1).
- `src/engine` stays pure TypeScript: no DOM, `fs`, Tauri.
- Offsets are UTF-16, end-exclusive.
- Each new regex is a named constant with a one-line example comment.
- New catalogue keys go in `en.json`, `hi.json`, `bn.json`; hi/bn are drafts for #4 (list them in the task report).
- Commit messages `type(scope): summary (#1 prep)`; no `Co-Authored-By` or AI attribution.
- Per commit `npm run test:changed`; engine tasks also `npm run trust` before review; end of plan `npm run test:release`, `npm run trust`, `npm run upgrade:check`.
- Work lands on `v1.0-dev` only; not released (ships with #1, owner 2026-11-04).

## Review Focus

1. A Harper fix ending just before a combining mark ("cafe" + U+0301) must never be applied, even when its tier would be `safe` → Task 2 test.
2. A stray zero-width joiner between Latin letters is still removed by hygiene (it sits inside a grapheme cluster) → Task 2 test.
3. An English sentence holding a Hindi word, or a French sentence the classifier reported, is not sent to the AI helper → Task 3 tests.
4. The read-aloud buttons update when only the caret moves (no re-check, no card change) → Task 4 DOM test.
5. An English-only PC with a Hindi paragraph at the caret says a voice for Hindi is needed, in the UI language → Task 4 DOM test.

---

### Task 1: The danda ends a sentence in zero-click line shapes

**Files:**
- Modify: `src/engine/zeroClick.ts:39-41` (`ENDS_SENTENCE`, `WIDE_GAP`)
- Test: `tests/engine/zeroClick.test.ts` (in `describe('findAlignedParagraphs …')`)

Today a Hindi sentence with a stray double space reads as a key–value line (no `.?!` at its end), so it is treated as layout. Harmless now (gate 1 caps non-English at `review`), wrong once gate 9 lifts the cap.

- [ ] **Step 1: Write the failing test**

```ts
it('leaves Hindi sentences with a stray double space to the space rule, after a word or a danda', () => {
  expect([...findAlignedParagraphs(paras('हम  घर गए।', 'सभा कक्ष  दस बजे भर गया।', 'बारिश हुई।', 'अंत।   अगला वाक्य।', 'पहला॥   दूसरा।'))]).toEqual([]);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/engine/zeroClick.test.ts` — expected FAIL (ids 0, 1, 3, 4 come back).
- [ ] **Step 3: Implement.** Add `।॥` to `ENDS_SENTENCE` (`/[.?!।॥]["”’)]*\s*$/u`) and to the `WIDE_GAP` look-behind's excluded set; update both example comments ("होम।").
- [ ] **Step 4: Run** the file again — PASS; then `npm run test:changed` and `npm run trust`.
- [ ] **Step 5: Commit** `fix(engine): a danda ends a sentence in zero-click line shapes (#1 prep)`.

---

### Task 2: No edit splits a character (grapheme clusters)

**Files:**
- Create: `src/engine/graphemes.ts`
- Modify: `src/engine/sessionIntake.ts` (`addCandidates`)
- Test: `tests/engine/graphemes.test.ts` (new), `tests/engine/nonEnglishSafety.test.ts` (session-level cases)

**Interfaces:**
- Produces: `splitsCharacter(text: string, span: Span): boolean` — true when `span.start` or `span.end` falls inside a grapheme cluster of `text` (a boundary at 0 or `text.length` never splits).
- Produces: `SPLITS_CHARACTER_REASON = 'it would split a character'` (exported from `graphemes.ts`).

- [ ] **Step 1: Write the failing unit tests** in `tests/engine/graphemes.test.ts`:

```ts
it.each([
  ['a base letter before its combining accent', 'café au lait', { start: 0, end: 4 }, true],
  ['the whole accented word', 'café au lait', { start: 0, end: 5 }, false],
  ['a Devanagari consonant without its vowel sign', 'किताब', { start: 0, end: 1 }, true],   // क + ि
  ['a whole Devanagari syllable', 'किताब', { start: 0, end: 2 }, false],
  ['half of a conjunct (virama)', 'क्षमा', { start: 0, end: 2 }, true],               // क ् | ष
  ['क्ष in क्षत्रिय, cut after the halant', 'क्षत्रिय', { start: 0, end: 2 }, true],
  ['the whole क्ष in क्षत्रिय', 'क्षत्रिय', { start: 0, end: 3 }, false],
  ['the first क of क्क in नक्काशी', 'नक्काशी', { start: 1, end: 3 }, true],
  ['the whole क्का in नक्काशी', 'नक्काशी', { start: 1, end: 5 }, false],
  ['भ् of भ्य in अभ्यास', 'अभ्यास', { start: 1, end: 3 }, true],
  ['the whole भ्या in अभ्यास', 'अभ्यास', { start: 1, end: 5 }, false],
  ['ऋ in ऋषि is one code point', 'ऋषि', { start: 0, end: 1 }, false],
  ['क without its ृ in कृषि', 'कृषि', { start: 0, end: 1 }, true],
  ['a Bengali conjunct cut after the hasanta', 'ক্ষমা', { start: 0, end: 2 }, true],
  ['inside an emoji ZWJ sequence', 'Hi 👩‍💻 there', { start: 3, end: 5 }, true],
  ['a zero-length insertion between two letters', 'ab', { start: 1, end: 1 }, false],
  ['the end of the text', 'ab', { start: 1, end: 2 }, false],
])('%s', (_name, text, span, splits) => {
  expect(splitsCharacter(text, span)).toBe(splits);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/engine/graphemes.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement `splitsCharacter`.** One module-level `new Intl.Segmenter(undefined, { granularity: 'grapheme' })`; a boundary `b` splits when `0 < b < text.length` and either `segments.containing(b)!.index !== b`, or the character before `b` is a halant (named constant `HALANT = /[्্]/`, "क्|ष"). The halant rule keeps conjuncts whole on engines older than Unicode 15.1 (older Safari/Firefox), which split `क्ष` into `क्` + `ष`. Segment the paragraph once per call (`segmenter.segment(text)`), not the document.
- [ ] **Step 4: Run** — PASS. Node 24 (ICU 77, Unicode 16) keeps क्ष, क्का, भ्या, त्रि as one cluster (checked 2026-11-05), so every row passes on Unicode alone. Add one test for the halant rule by itself, simulating a pre-15.1 engine: `vi.resetModules()`, `vi.stubGlobal('Intl', { ...Intl, Segmenter: OldSegmenter })` where `OldSegmenter` is the real segmenter that also breaks after every halant (split `क्ष` into `क्`, `ष`), then `await import('@/engine/graphemes')` and expect `क्ष` cut after the halant in `क्षत्रिय` and `नक्काशी` to still split; `vi.unstubAllGlobals()` after. Also: `'क्‌ष'` (explicit half form with ZWNJ) at `{ start: 0, end: 3 }` does not split — that is two characters on purpose.
- [ ] **Step 5: Write the failing session tests** in `tests/engine/nonEnglishSafety.test.ts`, new `describe('no edit splits a character')`, using `CheckSession.start` with injected candidates (as the file's existing tests do):
  - English paragraph `'We ate at the café today.'`, a `rules` Spelling candidate on `'cafe'` (span ends before U+0301) replacing `'café'`: outcome `status: 'rejected'`, `unplaceable: SPLITS_CHARACTER_REASON`, `auto: false`; the output text (`s.output()` or the file's existing helper) is unchanged; no decision holds its id.
  - Same paragraph, a `rules` Formatting candidate collapsing a double space elsewhere still applies (the guard is per candidate).
  - Paragraph `'ab‍cd'` (stray ZWJ between Latin letters): the `hygiene` deletion candidate for U+200D is still applied without a click (hygiene is exempt: its own rules already keep meaningful joiners, `hygiene.ts:82`).
  - A Devanagari-paragraph candidate (fake engine) whose span ends between `क` and `ि` is unplaceable as above.
- [ ] **Step 6: Run** — FAIL.
- [ ] **Step 7: Implement in `addCandidates`.** After a candidate gets its tier and `pending`: when `c.source !== 'hygiene'` and `splitsCharacter(paragraph text, c.span)`, set its tier to `'review'` (so `autoApply` never takes it) and record it unplaceable directly — `s.unplaceable.set(c.id, SPLITS_CHARACTER_REASON)` and `s.ledger.record(c.id, 'rejected', false, \`unplaceable: ${SPLITS_CHARACTER_REASON}\`)` — not through `markUnplaceable`, whose superseded/withdraw steps are for applied edits. One-line `// why` comment citing never-damage.
- [ ] **Step 8: Run** the two files — PASS; then `npm run test:engine`, `npm run trust`, and the timing test (`npm run test:release` runs it; locally `npx vitest run tests/timing`) — the rules pass must stay under 300 ms for 1,500 words.
- [ ] **Step 9: Commit** `fix(engine): never apply an edit that splits a character (#1 prep)`.

---

### Task 3: The AI helper reads only checked English

**Files:**
- Modify: `src/engine/llm/select.ts` (`pickSentences`; new export)
- Modify: `src/ui/state/aiSuggestions.ts:80-84` (`improveSentence`)
- Modify: `src/ui/i18n/en.json`, `hi.json`, `bn.json` (new key `ai.notChecked`)
- Test: `tests/engine/llm/select.test.ts`, `tests/dom/aiSuggestions.test.tsx`

**Interfaces:**
- Produces: `helperReads(session: CheckSession, paraId: number, span: Span): boolean` in `select.ts` — true when `session.engineOf(paraId)?.id === 'en'` and no `session.uncheckedPassages()` entry of that paragraph overlaps `span` (`overlaps` from `sessionTypes`). The `'en'` id check is temporary: the capabilities redesign (next plan) replaces it.

- [ ] **Step 1: Write failing tests** in `select.test.ts`, `describe('only checked English goes to the helper')`, each giving every sentence a `Style` lint so it would otherwise score:
  - A document whose majority is Devanagari (fake engine via `devanagariEngines(fakeEngine())` from `tests/fixtures/fakeEngines.ts`) with one English paragraph: `pickSentences(s, 10)` returns no sentence from the Hindi paragraphs, and none from the English paragraph either (it is set aside: `engineOf` is the not-checked engine).
  - English document, paragraph `'We met Ravi at the मंदिर gate. It was late.'`: only the second sentence is picked.
  - English document with a three-word-plus French sentence the classifier reports (reuse a sentence from `tests/engine/uncheckedPassages*.test.ts` that is known to be reported): that sentence is not picked; the English one beside it is.
  - `helperReads` is false for a paragraph id not in the document.
- [ ] **Step 2: Run** `npx vitest run tests/engine/llm/select.test.ts` — FAIL.
- [ ] **Step 3: Implement** `helperReads`, and skip a sentence in `pickSentences` when `!helperReads(...)` (before scoring). Leave `sentenceAt` as is; its doc comment says callers check `helperReads`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Add `ai.notChecked`.** en: `"The AI helper works only on English text the proofreader checked, and this sentence isn’t."` hi/bn drafts in the same meaning, using the term for "AI helper" already used by `ai.cantImprove` in each file.
- [ ] **Step 6: Write a failing DOM test** in `tests/dom/aiSuggestions.test.tsx`, following its caret pattern (`editor().dispatch({ selection: { anchor } })`, then the "Improve this sentence" action the file already drives): caret in the Hindi word's sentence of `'We met Ravi at the मंदिर gate. It was late.'` → the panel tells the `ai.notChecked` text and the helper client receives no request.
- [ ] **Step 7: Implement in `improveSentence`:** after `sentenceAt` returns a sentence, `if (!helperReads(session, paraId, sentence.span)) return this.tell(msg('ai.notChecked'));`.
- [ ] **Step 8: Run** both files, then `npm run test:changed`, `npm run test:engine`, `npm run trust`.
- [ ] **Step 9: Commit** `fix(ai): send the helper only English text the proofreader checked (#1 prep)`.

---

### Task 4: Read aloud follows the caret and names the missing voice

**Files:**
- Modify: `src/ui/state/readAloud.ts` (new export)
- Modify: `src/ui/DocumentView.tsx` (prop + update listener, ~line 312)
- Modify: `src/ui/App.tsx` (state, pass through)
- Modify: `src/ui/ReviewPanel.tsx:250-253` (`languageFor`), prop
- Modify: `src/ui/ReadAloudBar.tsx:47-48, 98` (note)
- Modify: `src/ui/i18n/en.json`, `hi.json`, `bn.json` (replace `read.needsEnglishVoice` with `read.needsVoice`)
- Test: `tests/ui/readAloud.test.ts`, `tests/dom/language.test.tsx:120-135`, `tests/dom/readAloudControls.test.tsx`

**Interfaces:**
- Produces: `interface CaretLanguages { sentence: string; paragraph: string }` and `caretLanguages(line: string, at: number): CaretLanguages` in `readAloud.ts` = the `textLanguage` of `sentenceAt(line, at)` and of `line.trim()`.
- Produces: `DocumentView` prop `onCaretLanguages(languages: CaretLanguages | null): void`; `ReviewPanel` prop `caretLanguages: CaretLanguages | null`.

Today `languageFor` pulls the caret only when the panel re-renders, so moving the caret from an English paragraph to a Hindi one leaves Sentence/Paragraph enabled for the old language. And the note only ever asks for an English voice.

- [ ] **Step 1: Unit tests** in `tests/ui/readAloud.test.ts`: `caretLanguages('We met. यह एक परीक्षण है।', 2)` → `{ sentence: 'en', paragraph: 'hi' }`; at offset 12 → `{ sentence: 'hi', paragraph: 'hi' }`; `caretLanguages('', 0)` → `{ sentence: 'en', paragraph: 'en' }`. Run — FAIL; implement; PASS.
- [ ] **Step 2: Failing DOM test** in `readAloudControls.test.tsx`: English voice only; open text `'We went home.\nयह एक परीक्षण है।'`; focus the editor and put the caret in the English line → Sentence and Paragraph enabled, no note; dispatch the caret into the Hindi line (no re-check, no card change) → both disabled and the bar shows the en `read.needsVoice` text with `{language}` = "Hindi"; caret back → enabled, note gone.
- [ ] **Step 3: Update the existing test** at `tests/dom/language.test.tsx:129` to expect `read.needsVoice` with the UI-language name of English (`'अंग्रेज़ी'` for hi — take it from `Intl.DisplayNames`, the same call the bar uses, not a literal). Add one case: Hindi UI, English voice only, Hindi text at the caret → note names Hindi in Hindi.
- [ ] **Step 4: Run** both DOM files — FAIL.
- [ ] **Step 5: Implement.**
  - `DocumentView`: in the existing update listener (same condition as the flag-at-cursor update: `docChanged || selectionSet || focusChanged`), compute `view.hasFocus ? caretLanguages(line.text, head - line.from) : null` from `state.doc.lineAt(head)`; call `onCaretLanguages` only when sentence or paragraph differs from the last value sent (keep it in a ref, as `spokenFlag` does) — no re-render per keystroke.
  - `App`: `useState<CaretLanguages | null>(null)`, pass to `ReviewPanel`.
  - `ReviewPanel.languageFor`: for `sentence`/`paragraph`, `caretLanguages?.[target]` when set, else today's card-based `textLanguage(documentTextFor(target))`.
  - `ReadAloudBar`: replace `needsEnglishVoice` with `const sentenceLanguage = languageFor('sentence'); const needsVoice = !readAloud.speaks(sentenceLanguage);` and render `t.t('read.needsVoice', { language })` where `language = new Intl.DisplayNames([t.language], { type: 'language' }).of(sentenceLanguage)`.
  - Catalogues — remove `read.needsEnglishVoice`, add `read.needsVoice`: en `"Sentence and Paragraph need a voice for {language} on this PC."`; hi `"वाक्य और पैराग्राफ़ पढ़ने के लिए इस PC पर {language} की आवाज़ चाहिए।"`; bn `"বাক্য আর অনুচ্ছেদ পড়ার জন্য এই PC-তে {language} ভয়েস দরকার।"` (drafts → #4).
- [ ] **Step 6: Run** the three test files — PASS; then `npm run test:changed` and `npm run test:dom` (rerun a failing DOM file alone before treating it as real: About-dialog tests flake under load).
- [ ] **Step 7: Commit** `fix(ui): read aloud follows the caret's language and names the voice it needs (#1 prep)`.

---

### End of plan

- [ ] `/simplify` on the four commits.
- [ ] `npm run test:release`, `npm run trust`, `npm run upgrade:check` — all green.
- [ ] Update `.superpowers/sdd/2026-11-02-language-engine/progress.md` lines 40-44: strike the danda, Segmenter (boundary guard; caseless name protection stays), AI helper and read-aloud items; list the new hi/bn draft keys (`ai.notChecked`, `read.needsVoice`) for #4.
- [ ] Push `v1.0-dev` only (remote `github`); comment progress on #1. No release.
