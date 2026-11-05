# Engine Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each language engine one description (script, spoken language, variants, trust policy) that the app reads instead of `'en'` id checks, and replace the blanket "non-English is at most review" cap with a per-engine trust policy, so Devanagari text gets the same no-click fixes as English and nothing more.

**Architecture:** `EngineCapabilities` gains `script`, `language` and a small data-only `trust` policy. `tiers.ts`, `sessionIntake.ts` and `defaultTicks.ts` read each paragraph's capabilities from the tier context instead of `englishParagraphs`. A new shared pass in session setup finds locked text once for the whole document, plus invisible characters for every proofread paragraph and double spaces for non-English ones. Engines receive that pass instead of computing locks themselves.

**Tech Stack:** TypeScript, React, Vitest (+ Testing Library for `tests/dom`).

**Spec:** `docs/superpowers/specs/2026-11-05-engine-capabilities-design.md` (approved 2026-11-05). Coding rules: `CLAUDE.md`.

## Global Constraints

- Any English behaviour change is a failure: tiers, ticks, card membership, zero-click, labels. `npm run trust`, the never-damage tests and existing tier tests must pass **unchanged** (no edited expectations for English).
- A non-English paragraph gets nothing beyond spaces/invisible characters without a click, and nothing pre-ticked.
- `isOtherLanguageWord` (romanised model, can throw) never runs for a non-English paragraph.
- `src/engine` stays pure TypeScript; offsets UTF-16, end-exclusive; named regex constants with an example comment.
- Simple over general: the trust policy is data (closed string unions), not callbacks.
- New hi/bn catalogue strings are drafts for #4 (list them in the task report).
- Commits `type(scope): summary (#1)`; no `Co-Authored-By` or AI attribution.
- Per commit `npm run test:changed`; engine tasks `npm run trust` before review; end of plan `npm run test:release`, `npm run trust`, `npm run upgrade:check`. **Run test commands one at a time** (16 GB PC; parallel runs get killed).
- Work lands on `v1.0-dev` only; not released.

## Review Focus

1. A Devanagari paragraph with a stray double space and a zero-width space gets both fixed without a click, and a Hindi spelling fix with a single replacement still waits for review → Task 2 end-to-end test.
2. A user who opted a kind into "safe" in Settings sees that kind on a Hindi paragraph on the card, unticked, never applied without a click, and no crash from the romanised model → Task 1 test.
3. A double space inside a URL, a code span or a laid-out key–value line in a Hindi paragraph is never collapsed → Task 2 test.
4. An English document with a set-aside Bengali paragraph and a fenced code block produces exactly the same candidates and tiers as before the single lock pass → Task 2 test (ids and tiers compared with a fixture).
5. With the fake Hindi engine proofreading, the toolbar shows no variant picker, the status bar no variant, and "Nothing to check" never says "English" → Task 4 DOM test.

---

### Task 1: Engine description and per-engine trust policy

**Files:**
- Modify: `src/engine/languageEngine.ts` (types), `src/engine/englishEngine.ts:31-38` (capabilities), `src/engine/notCheckedEngine.ts:8`
- Modify: `src/engine/tiers.ts` (`TierContext.englishParagraphs` → `paragraphEngines`; `tierOf`)
- Modify: `src/engine/sessionIntake.ts` (`sessionTier`), `src/engine/defaultTicks.ts` (`TickContext`, `startsTicked`), `src/engine/sessionDecisions.ts:44` (caller)
- Modify: `src/engine/sessionSetup.ts` (`withOtherEnginesLocked` sets `paragraphEngines` for every paragraph)
- Modify: `tests/fixtures/fakeEngines.ts`
- Test: `tests/engine/nonEnglishSafety.test.ts`, `tests/engine/languageEngine.test.ts`

**Interfaces:**
- Produces (in `languageEngine.ts`):
  ```ts
  /** How far an engine's fixes are trusted (spec G2). Data only; the shared tier code switches on these values. */
  export interface TrustPolicy {
    /** May a fix in this engine's paragraphs be applied without a click (isZeroClickChange still decides which). */
    zeroClick: boolean;
    /** 'english': today's baseTier rules. 'layoutOnly': safe only for hygiene and the shared double-space fix. */
    safeKinds: 'english' | 'layoutOnly';
    /** Which card fixes may start ticked: English's slip-doubling allowlist, or none. */
    ticks: 'slipDoublings' | 'none';
  }
  // EngineCapabilities gains:
  script: string | null;    // 'Latin', 'Devanagari'; null for the not-checked engine
  language: string | null;  // 'en', 'hi'; null for the not-checked engine
  trust: TrustPolicy;
  ```
  English: `script 'Latin', language 'en', trust { zeroClick: true, safeKinds: 'english', ticks: 'slipDoublings' }`. Not-checked: `script null, language null, trust { zeroClick: false, safeKinds: 'layoutOnly', ticks: 'none' }`.
- Produces (in `tiers.ts`): `TierContext.paragraphEngines?: ReadonlyMap<number, EngineCapabilities>` (replaces `englishParagraphs`). A paragraph with no entry behaves as English (tests and English-only contexts build no map).
- Produces (in `defaultTicks.ts`): `TickContext.ticks(paraId: number): TrustPolicy['ticks']`.
- `fakeEngine()` gets `script: 'Devanagari', language: 'hi', variants: [], trust: { zeroClick: true, safeKinds: 'layoutOnly', ticks: 'none' }` (variants were `['Standard']`; Hindi has none, spec G1).

- [ ] **Step 1: Rewrite the gate-1 tests to the new policy** in `nonEnglishSafety.test.ts`. The existing test "a whitespace fix in a Hindi paragraph is never applied without a click" encodes the stopgap that owner decision 1 replaces: rename it "a whitespace fix in a Hindi paragraph is applied without a click, like English" and expect `tier 'safe'`, outcome `{ status: 'applied', auto: true }`. Keep every other existing test's expectation. Add:
  - a Hindi-paragraph `rules` Spelling candidate with one replacement → `tier 'review'`, pending, not on the simple-fixes card;
  - a Hindi-paragraph Formatting fix that is not a space collapse (e.g. `'।।'` → `'।'`) → `'review'`;
  - with `tierOverrides: { Spelling: 'safe' }` (opts), a Hindi Spelling candidate → `'batch'`, on the card, in `untickedByDefault`'s list, not applied; and creating the session does not throw although the romanised model is not loaded (`isOtherLanguageWord` not reached);
  - a Hindi doubled word `'और और'` as a Repetition candidate → never ticked (ticks 'none').
- [ ] **Step 2: Run** `npx vitest run tests/engine/nonEnglishSafety.test.ts` — FAIL (the renamed test and the override test).
- [ ] **Step 3: Implement.**
  - `tierOf`: `const engine = ctx.paragraphEngines?.get(c.paraId)`; the base tier is `baseTier(c, ctx)` when `engine` is undefined or `engine.trust.safeKinds === 'english'`, else `layoutTier(c)` = `'safe'` for `source 'hygiene'` or a space-collapse fix (`source 'rules'`, one replacement `' '`, original matching the existing `SPACE_RUN` shape — export it from zeroClick.ts rather than duplicating), otherwise `'review'`. The hidden checks before it stay shared. Delete the `englishParagraphs` cap. `isOtherLanguageWord` runs only when `engine === undefined || engine.language === 'en'`. Every other post-'safe' check stays shared (they only lower a tier — spec "Settled" rule).
  - `sessionTier` (sessionIntake.ts): when the paragraph's engine has `trust.zeroClick === false`, a 'safe' tier becomes 'batch' (never applied without a click).
  - `startsTicked` (defaultTicks.ts): return false when `ctx.ticks(c.paraId) === 'none'`; the caller in sessionDecisions.ts passes `(paraId) => s.ctx.paragraphEngines?.get(paraId)?.trust.ticks ?? 'slipDoublings'`.
  - `withOtherEnginesLocked` (sessionSetup.ts): set `paragraphEngines` to every paragraph's capabilities (a map from `paragraphEngines` it already has); drop `englishParagraphs`. Update the comments that mention the cap (sessionSetup.ts:72, tiers.ts:284) to describe the policy.
- [ ] **Step 4: Add a capabilities test** in `languageEngine.test.ts`: `createEnglishEngine().capabilities` has `script 'Latin'`, `language 'en'`, the English trust policy; `notCheckedEngine.capabilities.trust.zeroClick === false`.
- [ ] **Step 5: Run** the two files, then `npm run test:engine` and `npm run trust` (one at a time) — PASS with no English test expectation edited. If an English test changes, stop: that is an anti-goal; report it.
- [ ] **Step 6: Commit** `feat(engine): per-engine trust policy replaces the non-English review cap (#1)`.

---

### Task 2: One shared pass: locked text, invisible characters, double spaces

**Files:**
- Create: `src/engine/sharedText.ts`, `src/engine/doubleSpaces.ts`
- Modify: `src/engine/languageEngine.ts` (`LanguageEngine.check` signature), `src/engine/englishEngine.ts` (`checkEnglish` uses the shared pass), `src/engine/sessionSetup.ts` (`prepareCheck`; delete `withOtherEnginesLocked`'s second `findLockedText`), `tests/fixtures/fakeEngines.ts`
- Test: `tests/engine/sharedText.test.ts` (new), `tests/engine/doubleSpaces.test.ts` (new), `tests/engine/nonEnglishSafety.test.ts`

**Interfaces:**
- Consumes: Task 1's `EngineCapabilities.language`, `TierContext.paragraphEngines`.
- Produces:
  ```ts
  // sharedText.ts
  export interface SharedText {
    /** paraId → locked spans (findLockedText over the whole document). */
    locked: Map<number, Span[]>;
    /** findLockedText's command text: surely and maybe, by paraId. */
    commands: { surely: Map<number, Span[]>; maybe: Map<number, Span[]> };
    /** paraId → invisible-character candidates (findInvisible with that paragraph's locks). */
    invisible: Map<number, Candidate[]>;
  }
  export function findSharedText(paras: Paragraph[], language: CheckOptions['language']): SharedText;
  // doubleSpaces.ts
  export function findDoubleSpaces(p: Paragraph, locked: readonly Span[] | undefined): Candidate[];
  // languageEngine.ts
  check(paras: Paragraph[], opts: CheckOptions, shared: SharedText, pause?: () => Promise<void>): Promise<Result>;
  ```
- `findDoubleSpaces` candidates: `source 'rules'`, `kind 'Formatting'`, `replacements [' ']`, `original` the run of 2+ spaces between two non-space characters, id `${paraId}:${start}:${end}:Formatting` (the linter's id scheme), `message` = the exact message Harper gives its own double-space Formatting lint (find it in `src/ui/state/plainMessages.ts` so the card explanation maps). None inside a locked span.

- [ ] **Step 1: Unit tests.** `doubleSpaces.test.ts`: `'यह  परीक्षण है।'` → one candidate on the two spaces; three spaces → one candidate over all three; a leading/trailing run → none; a run inside a locked span → none; a single space → none. `sharedText.test.ts`: for a three-paragraph document (English, Hindi with a URL, a fenced code block spanning paragraphs), `findSharedText` locks equal what `findLockedText` returns for the whole document, and `invisible` holds a zero-width space found in the Hindi paragraph.
- [ ] **Step 2: Run** both — FAIL (modules missing). Implement both modules (`findSharedText` = one `findLockedText(paras, language)` call plus `findInvisible(p, locked.get(p.id))` per paragraph). Run — PASS.
- [ ] **Step 3: English equivalence test (Review Focus 4)** in `sharedText.test.ts` or `session.test.ts`: an English document with a set-aside Bengali paragraph and a fenced code block spanning two paragraphs gives the same candidate ids, tiers and outcomes as on `v1.0-dev` before this task. Capture the expected values by running the test once **before** Step 4 and pasting them as literals.
- [ ] **Step 4: Wire it in.**
  - `prepareCheck` computes `findSharedText(allParas, opts.language)` once, passes it to every engine's `check`, and sets the context's `locked`, `commandSpans`, `maybeCommandSpans` from it for all paragraphs (`withOtherEnginesLocked` keeps only the `paragraphEngines` map from Task 1, or is folded away).
  - Invisible-character candidates are added by `prepareCheck` for every paragraph whose engine `proofreads` (not set-aside ones). `checkEnglish` uses `shared.invisible` for its visible-text mapping and `kept` offsets but no longer pushes them into `found` (identical candidates, one place).
  - `findDoubleSpaces` candidates are added for every paragraph whose engine proofreads and whose `language !== 'en'` (English keeps Harper's).
  - The fake engine ignores `shared`.
- [ ] **Step 5: End-to-end test (Review Focus 1, 3)** in `nonEnglishSafety.test.ts` with the fake Devanagari engine (finding nothing itself):
  - a Hindi paragraph with a double space between two words and an invisible character that `findInvisible` deletes next to Devanagari letters (pick one from hygiene.ts that it does delete there, e.g. U+FEFF, not ZWJ/ZWNJ which it keeps) → both applied without a click; assert the exact output text;
  - `'उसने कहा "नमस्ते  दोस्त" और गया।'` → the double space inside the locked quote is not collapsed (no applied candidate there);
  - a key–value line `'नाम      राहुल'` between two sentences is not collapsed (aligned);
  - a set-aside paragraph (English in a mostly-Hindi document) with a double space gets no candidate.
- [ ] **Step 6: Run** the new and changed files, `npm run test:engine`, `npm run trust`, then `npx vitest run tests/timing` alone (the rules pass stays under 300 ms for 1,500 words) — PASS.
- [ ] **Step 7: Commit** `feat(engine): one shared locked-text, invisible-character and double-space pass for every engine (#1)`.

---

### Task 3: Readers use the description: foreign sentences and the AI helper

**Files:**
- Modify: `src/engine/languageEngine.ts` (`EngineResult`), `src/engine/englishEngine.ts` (return value), `src/engine/sessionSetup.ts` (return the proofreader's foreign sentences), `src/engine/session.ts:131-134`, `src/engine/llm/select.ts:22`
- Test: `tests/engine/languageEngine.test.ts`, `tests/engine/llm/select.test.ts`

**Interfaces:**
- Consumes: Task 1 `EngineCapabilities.language`; Task 2 `prepareCheck`.
- Produces: `EngineResult.foreignSentences?: Map<number, Span[]>` — sentences mostly in another language that the engine found in its paragraphs; English returns today's `findForeignSentences` map (it still also puts it in its tier context for the zero-click guard); others return none. `prepareCheck`'s return gains `foreignSentences: Map<number, Span[]>` = the proofreader's.

- [ ] **Step 1: Tests.** `languageEngine.test.ts`: a fake engine that returns `foreignSentences` for its paragraph → `session.uncheckedPassages()` reports it as `otherLanguage` when that engine proofreads; with English proofreading, an English document's French sentence is still reported (existing test stays green). `select.test.ts`: `helperReads` is true for an English paragraph and false for a paragraph whose engine has `language 'hi'` though its id is not `'hi'` (fake id `'fake-hi'`), proving the check reads `language`, not `id`.
- [ ] **Step 2: Run** — FAIL. **Implement:** session.ts reads `setup.foreignSentences` instead of `proofreader.capabilities.id === 'en' ? ctx.foreignSentences : …`; `setAside` compares engines by identity or `capabilities` object rather than `id`; `helperReads` uses `engineOf(paraId)?.language === 'en'`. **Run** — PASS; then `npm run test:changed`, `npm run trust`.
- [ ] **Step 3: Commit** `refactor(engine): foreign sentences from the engine, AI helper by spoken language (#1)`.

---

### Task 4: UI reads the description: variants and per-engine labels

**Files:**
- Modify: `src/ui/proofreadingLabels.ts` (remove `proofreadsEnglish`; add `nothingToCheck` labels; document `SCRIPT_LANGUAGES` as the read-aloud voice table)
- Modify: `src/ui/Toolbar.tsx:16, 87, 141-147`, `src/ui/StatusBar.tsx:37`, `src/ui/SettingsPanel.tsx:151`, `src/ui/ReviewPanel.tsx:211`, `src/ui/state/sessionController.ts:469`
- Modify: `src/ui/i18n/en.json`, `hi.json`, `bn.json`
- Test: `tests/dom/proofreadingLabels.test.tsx`, `tests/dom/hindiProofreading.test.tsx`, `tests/ui/readAloud.test.ts`

**Interfaces:**
- Consumes: Task 1 capabilities (`variants`, `language`, `script`).
- Produces (proofreadingLabels.ts): `pickerVariants(session: CheckSession | null): Variant[]` — the proofreading engine's `variants` that are known `Variant`s (`VARIANT_KEYS` has them); before a check, English's list (export `ENGLISH_VARIANTS` from englishEngine.ts and reuse it; delete Toolbar's `VARIANTS` copy). `ProofreadingLabels` gains `nothingToCheck: MessageKey` and `announceNothing: MessageKey`; English rows use `panel.nothingToCheck` / `announce.nothingToCheck`; Hindi rows use new `panel.nothingToCheckHindi` / `announce.nothingToCheckHindi`.
- New en strings: `"panel.nothingToCheckHindi": "Nothing to check: no Hindi words"`, `"announce.nothingToCheckHindi": "Check finished: nothing to check, no Hindi words."` hi/bn: drafts with the same meaning, using each file's existing word for "Hindi" and the wording of the English-row keys.

- [ ] **Step 1: DOM tests (Review Focus 5).** With the fake Devanagari engine proofreading a mostly-Hindi document: no variant picker in the toolbar, no variant in the status bar, no mixed-spelling chip; English document: picker lists exactly American, British, Australian, Canadian, Indian (unchanged). A Hindi-proofread document whose checked text has no Devanagari letters says the Hindi "Nothing to check" text, panel and announcement. Settings › variant list unchanged for English. `readAloud.test.ts`: for every engine in `createScriptEngines()` and the fake, `SCRIPT_LANGUAGES[engine.capabilities.script] === engine.capabilities.language`.
- [ ] **Step 2: Run** — FAIL. **Implement** the interfaces above; every former `proofreadsEnglish(session)` call becomes `pickerVariants(session).length > 0`; ReviewPanel and sessionController take the "nothing to check" keys from `proofreadingLabels(session)`.
- [ ] **Step 3: Run** the three test files, `npm run test:changed`, `npm run test:dom` (rerun a failing DOM file alone first) — PASS.
- [ ] **Step 4: Commit** `refactor(ui): variant picker and labels from the engine description (#1)`.

---

### End of plan

- [ ] `/simplify` on the plan's commits.
- [ ] `npm run test:release`, `npm run trust`, `npm run upgrade:check` — one at a time, all green. Offer `cargo clean` in `src-tauri` afterwards if disk is tight.
- [ ] Update `.superpowers/sdd/2026-11-02-language-engine/progress.md` (#1 remaining list: a, b, c, h done; g deferred per owner 2026-11-05).
- [ ] Push `v1.0-dev` only (remote `github`); progress comment on #1 listing the new hi/bn draft keys. No release.
