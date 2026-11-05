# Engine capabilities: one description per language engine (#1)

Date: 2026-11-05. Status: design, approved in conversation (owner), pending builder check.

## Why

Kashiro is about to get its second proofreading engine (Hindi, #1). Today the rest of the app learns what an engine is by
checking its id (`'en'`) or by keeping its own table that has to agree with the engine. And every paragraph not checked
by English is capped at "review" by one blanket rule (`englishParagraphs` in `tiers.ts:285`). That cap was a deliberate
stopgap (#1 gate 1): nothing in another language was trusted until that language had its own policy. This design gives
each engine one description that everything reads, and replaces the stopgap with a per-engine trust policy.

Success: English documents behave exactly as today. A Devanagari document gets the same no-click fixes English gets
(spaces between words, invisible characters) and nothing more. Adding Hindi rules later means filling in the Hindi
engine's description, not editing shared code.

## Owner decisions (2026-11-05)

1. **No-click fixes: same as English for every language.** Only spaces between words and invisible characters, never
   in locked, command or laid-out text (the existing `isZeroClickChange` rule).
2. **Simple-fixes card: same as English.** A fix is on the card only when its engine calls its kind safe; it starts
   ticked only when it is on a closed, listed set the engine supplies. Nothing is pre-ticked unless clearly safe.
   Hindi's set starts empty.
3. **Marathi / Nepali (Devanagari) are checked by the Hindi engine for now.** No document-language setting in this
   work (item g stays deferred).
4. Scope as played back: engine description (script, spoken language, variants, trust policy, labels), plus the
   single lock pass and per-engine foreign sentences, plus per-engine "Nothing to check" wording.

## Goals

- **G1. One engine description.** `EngineCapabilities` (src/engine/languageEngine.ts) carries:
  - `id` (as today), `proofreads` (as today), `hasCase` (as today);
  - `script`: the Unicode script it proofreads (`'Latin'` for English; the `scriptEngines` key for others);
  - `language`: spoken language, BCP-47 base (`'en'`, `'hi'`); the not-checked engine has none;
  - `variants`: as today (English: American, British, Australian, Canadian, Indian; Hindi: none);
  - the **trust policy** (G2).
- **G2. Per-engine trust policy** replacing the `englishParagraphs` cap:
  - `zeroClick: boolean`: may this engine's paragraphs get no-click fixes (spaces, invisible characters)? English and
    any proofreading engine: yes. Not-checked engine: no (it produces no candidates anyway).
  - which candidate kinds are **safe** (card members) for this engine. English: today's `SAFE_RULE_KINDS`, a/an swaps,
    slip doublings, hygiene. Hindi (and the test fake): hygiene and whitespace/formatting kinds only — builder to pick
    the minimal set that lets the zero-click rule fire; everything else 'review'.
  - which fixes **start ticked** (`untickedByDefault` in defaultTicks.ts): English's slip-doubling allowlist; others an
    empty set.
  - English-only judgement in the shared tier code (variant words, Oxford comma, compound changes, title-case
    headings, capital-letter word rewrites, `isOtherLanguageWord`, `followsAbbreviation`, article swaps) runs only for
    paragraphs whose engine is English (or is moved behind the English engine's policy). Language-independent guards
    stay shared: locks, commands, code noise, invisible-character proximity, digits, LLM output, one-replacement rule,
    the grapheme split guard.
- **G3. Readers use the description, not the id.**
  - AI helper (`helperReads`, src/engine/llm/select.ts): `engineOf(paraId)?.language === 'en'` instead of `id === 'en'`.
  - Session (session.ts:133): foreign sentences come from the engine (G5), not an `id === 'en'` check.
  - UI: `proofreadsEnglish()` (proofreadingLabels.ts) is replaced by "the proofreading engine has variants" for the
    variant picker, status-bar variant and mixed-spelling chip. The variant lists in Toolbar.tsx and SettingsPanel.tsx
    come from `capabilities.variants` (English before a check). `sessionStore.ts`'s saved-review validation keeps its
    own closed list of English variant names (it validates stored data, not the UI) — builder may derive it from the
    English engine's list.
- **G4. Labels per engine** stay in the existing `PROOFREADING_LABELS` table keyed by engine id (src/engine never
  imports UI keys). Add the "Nothing to check" wording to that table so a Hindi document never says "no English
  words" (panel and announcement). New hi/bn strings are drafts for #4.
- **G5. One lock pass, foreign sentences from the engine.** `findLockedText` runs once over all paragraphs (today
  English computes its locks inside its engine and `withOtherEnginesLocked` runs a second pass for the others).
  Each engine's result may carry the foreign-language sentences it found; English returns today's classifier
  sentences, Hindi/fake return none. The session reads them from the result, not from an English-only context field.

## Non-goals

- The Hindi rules, dictionary and real Hindi engine (#1 proper).
- A document-language setting / one engine per script limit (item g) and Latin-script languages other than English (#40).
- Name protection for scripts without capital letters (needs the Hindi engine).
- Any change to which fixes English applies, offers or ticks.

## Anti-goals (a failure even if it "works")

- Any English behaviour change: tiers, ticks, card membership, zero-click, labels. The trust suite (`npm run trust`),
  the never-damage tests and existing tier tests must pass unchanged.
- A non-English paragraph getting anything beyond spaces/invisible characters without a click, or any pre-ticked fix.
- `isRomanisedIndic` (or any English-only check that needs a loaded model) running on another engine's candidates: today
  the cap makes that unreachable; after the cap goes, the English-only checks must not run for non-English paragraphs.
- New seams with one implementation beyond what G1–G5 need (CLAUDE.md: simple over general).

## Constraints

- `src/engine` stays pure TypeScript (no DOM / UI imports). Offsets UTF-16, end-exclusive.
- Test tiers per CLAUDE.md; `npm run trust` for engine changes; release gates at the end. Low-memory PC: run test
  commands one at a time.
- Work lands on `v1.0-dev`, not released (ships with #1, owner 2026-11-04).
- Tests use the fake Devanagari engine (`tests/fixtures/fakeEngines.ts`), extended to declare its own capabilities.

## Settled after the builder check (my calls unless marked)

- **Where a Hindi paragraph's no-click candidates come from.** Today invisible-character fixes (`findInvisible`,
  source 'hygiene') run only inside the English engine, and double-space fixes come from Harper ('rules',
  'Formatting'). A Hindi engine has neither, so owner decision 1 would be empty in practice. *My call:* a shared
  **layout pass** in the session runs for every paragraph a proofreading engine checks: invisible characters
  (`findInvisible` moved out of the English engine, identical candidates for English — tested) and, for non-English
  engines only, a small double-space-between-words detector (English keeps Harper's, so English output is unchanged).
  Its candidates still go through `isZeroClickChange`, locks, commands and `tokenGuard` like today.
- **Invisible characters in Devanagari:** the same rule as English. `hygiene.ts` is already script-aware (keeps ZWJ/ZWNJ
  next to Indic letters and in emoji); no engine-specific variant.
- **Single lock pass:** `findLockedText` moves to `sessionSetup` and runs once over all paragraphs; engines receive
  the locks rather than computing them. English still runs on every document (it supplies the variant and the tier
  context), as today.
- **Which tier checks are English-only.** Rule: a check that can **raise** a tier, or that needs an English-only model,
  belongs to the engine's policy; a check that can only **lower** a tier stays shared (harmless for any language).
  So: `baseTier` (preset kinds, `SAFE_RULE_KINDS`, article swaps, slip doublings, title-case headings, Oxford comma,
  compound changes) becomes the English engine's policy; other engines' policy is "safe = hygiene + the shared
  double-space fix, everything else review". `isOtherLanguageWord` (romanised model, can throw) runs only for English
  paragraphs. All other post-'safe' demotions stay shared.
- **User kind overrides on a Hindi paragraph:** same as English — an opted-in kind can reach the card but never starts
  ticked and never becomes no-click (existing `optedIn` and `isZeroClickChange` rules). `untickedByDefault` gets each
  paragraph's tick list through `TickContext`.
- **Mixed documents:** routing is unchanged (owner 2026-11-02): in a Hindi-majority document English paragraphs are
  set aside. The AI helper decides per paragraph (`engineOf(paraId).language`); the variant picker, status bar and
  mixed-spelling chip decide per document (the proofreading engine).
- **"Nothing to check" wording** is per proofreading engine (the label table has rows only for proofreading engines).
  A document with no text in any engine's script falls back to English as today, so "no English words" stays accurate.

## Left to the builder (my calls, marked)

- Exact type shape of the trust policy (fields on `EngineCapabilities` vs a nested `policy` object) and how
  `TierContext` gets each paragraph's policy (a `paraId → policy` map replacing `englishParagraphs` is the obvious
  form). *My call:* keep `tierOf`'s public signature; the context carries per-paragraph policy.
- Read aloud keeps `SCRIPT_LANGUAGES` (proofreadingLabels.ts:76) as the **voice** table: it covers scripts with no
  engine (Bengali), so it cannot come from engines alone. *My call:* keep it, document it as the read-aloud table,
  and make sure an engine's `language` and this table agree (a test).
- Whether the "safe kinds" for Hindi include anything beyond what the zero-click rule needs. *My call:* no — the
  minimum, so behaviour matches owner decision 1–2 exactly.
- Task order: G1+G2 first (the risky part, never-damage tests), then G3, G4, G5.
