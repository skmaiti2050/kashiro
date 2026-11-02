# Language-engine interface (#2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the proofreading engine behind a `LanguageEngine` interface, route each paragraph to an engine, and drive the "English proofreading" labels from the engine's capabilities — so a Hindi (or Bengali) engine can later be ADDED without touching the English path.

**Architecture:** Two real implementations today justify the seam (CLAUDE.md: "Don't add a seam until two implementations need it"): the **English engine** (Harper plus the existing follow-up passes, moved unchanged out of `prepareCheck`) and the **not-checked engine** (what #2a ships for paragraphs mostly in another script: no suggestions, marked "Not checked"). `prepareCheck` keeps its single partition point (today `otherScriptParagraphIds`) and becomes the router. The tier policy (Harper kind names, English word lists in tiers.ts / wordFlags.ts / presets.ts / defaultTicks.ts), grapheme segmentation, and caseless-script rules are NOT moved now: they are designed with the first Hindi rules (#1).

**Tech Stack:** TypeScript, harper.js, Vitest.

**Spec:** GitHub issue #2 part (b) ("a second engine can be added without touching the English path"); owner decisions 2026-11-02:
- scope = the interface + routing + capabilities-driven labels (steps 1 and 2); tier policy deferred to #1;
- variants are per engine: English keeps American/British/Australian/Canadian/Indian; Hindi and Bengali have regional dialects too, but the first engines will offer only the standard (officially recognised) written form — so the interface's variant list is engine-defined strings, not the English `Variant` type.
Map of English assumptions (2026-11-02 exploration) is summarised in the ledger.

## Global Constraints

- **Pure refactor for behaviour.** After Task 1 and Task 2, every existing test passes UNCHANGED (only imports/construction in tests may change, and only where a test builds the pipeline by hand), `npm run trust` passes 79/79, and `deps/reports/decisions.md` md5 stays `a0a3bdbd73b3211ee5c648ffc7584a84`. Candidate ids, order, tiers, ticks, notices and saved-review snapshots are byte-identical. Any difference is a defect, not a baseline update.
- No new dependency. No change to Harper usage, word lists, or the order of the follow-up passes.
- Owner's agent rules: Write/Edit only (no sed — not even in display pipes —, heredoc, python, redirection, shell rm); tests first where behaviour is new; `npx tsc --noEmit`, `npm test` (name any failing file; if a DOM test fails, rerun that file alone and report both), `npm run trust` when src/engine changes; `git commit -F`; no AI attribution; no stash/reset/amend/push/branch switching; one heavy command at a time; no subagents.
- CLAUDE.md: deep modules, one responsibility per file, no options without a second caller; files already over ~300 lines (session.ts, sessionSetup.ts?) get only what is needed.
- Commits `refactor(engine): …` / `refactor(ui): …`. #2b's acceptance ("a second engine can be added without touching the English path") is met by this plan, so the last commit body says `Fixes #2`; the Hindi engine itself is #1.

## Review Focus

1. A mixed document (English, Hindi, English, Bengali) gives exactly today's candidates, ids and "Not checked" paragraphs.
2. The personal dictionary still reaches Harper (`addWords`) and a dictionary add re-check behaves as today (#11 tests).
3. Tests that inject a fake linter (`deps.linter`) still work without rewriting their assertions.
4. Variant detection and the variant picker are unchanged for English; nothing in the generic interface imports the English `Variant` type.
5. The web build and desktop build both construct the English engine (no Tauri import in shared engine code; `src/engine` stays platform-free).

---

### Task 1: The interface, the English engine, and the router

**Files:** Create `src/engine/languageEngine.ts` (interface + capabilities type), `src/engine/englishEngine.ts`, `src/engine/notCheckedEngine.ts`. Modify `src/engine/sessionSetup.ts` (`prepareCheck` becomes the router; the English follow-up chain at ~100-131 moves into the English engine unchanged), `src/engine/sessionTypes.ts` (deps), `src/engine/session.ts` (engine per paragraph; `otherScriptParagraphs()` derived from it), `src/ui/platform/linter.ts`, `src/ui/platform-web/linter.ts`, `src/ui/state/sessionController.ts`, `src/ui/App.tsx` (construction only). Tests: new `tests/engine/languageEngine.test.ts`.

**Interfaces (produced):**
- `interface LanguageEngine { readonly capabilities: EngineCapabilities; check(paras: Paragraph[], opts): Promise<EngineResult>; addWords(words: string[]): void }` — exact `opts`/`EngineResult` shapes are the implementer's to derive from what `prepareCheck` passes and returns today (candidates, variant info, foreign/romanised sentences, unchecked paragraphs from linter failures); keep them minimal.
- `interface EngineCapabilities { id: string; proofreads: boolean; nameKey: MessageKey | null /* e.g. the "English" label; null for not-checked */; variants: readonly string[]; hasCase: boolean }` — English: `{ id: 'en', proofreads: true, variants: ['American','British','Australian','Canadian','Indian'], hasCase: true }`; not-checked: `{ id: 'none', proofreads: false, variants: [], hasCase: false }`.
- Routing: one function deciding the engine per paragraph from the existing script test (`otherScriptParagraphIds` rule unchanged). `CheckSession` exposes `engineOf(paraId)` (or equivalent) and keeps `otherScriptParagraphs()` working.

- [ ] Step 1: new tests (RED): the router assigns English/not-checked per paragraph for a mixed document; the not-checked engine returns no candidates; `englishEngine.capabilities` as above; `notCheckedEngine.capabilities` as above; a fake engine passed in deps is used for its paragraphs (proves the seam).
- [ ] Step 2: move code without changing it (cut/paste the chain into the English engine; keep function order). Existing tests must pass unchanged.
- [ ] Step 3: `npx tsc --noEmit`, `npm test`, `npm run trust`; compare: test count, trust 79/79, md5 identical.
- [ ] Step 4: commit `refactor(engine): a language engine per paragraph — English and not-checked (#2)`.

### Task 2: Capabilities drive the labels

**Files:** `src/ui/Toolbar.tsx` (chip), `src/ui/ReviewPanel.tsx` (panel wording that says "English"), `src/ui/AboutDialog.tsx`, `src/ui/SettingsPanel.tsx` (language hint), session/controller getters. Tests: tests/dom (extend notChecked.test.tsx / language tests).

- [ ] Step 1: tests (RED where new): the chip label comes from the proofreading engine's `nameKey` (a test engine with another name key changes the chip); with the English engine, every visible string is unchanged (existing tests pass unchanged).
- [ ] Step 2: implement: the UI asks the session for the engines in use (proofreading ones) instead of hard-coding English; English-specific strings stay as they are for English. No new user-facing strings unless unavoidable (then en/hi/bn).
- [ ] Step 3: `npx tsc --noEmit`, `npm test`.
- [ ] Step 4: commit `refactor(ui): proofreading labels come from the engine's capabilities (#2)`, body `Fixes #2`.
