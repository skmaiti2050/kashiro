# v1.2.1 Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close #10 (the token backstop misses a moved invisible character) and #32 (flaky About-dialog DOM tests and the 2,000-row timing test) for the v1.2.1 patch release.

**Architecture:** #10 adds a second check to `keepsTokens` in `src/engine/tokenGuard.ts`. Each invisible character that stays must keep its anchor, meaning the number of visible characters before it. #32 changes tests only: a longer async timeout in the DOM setup, and a time-per-row check across 200, 500, 1,000 and 2,000-row tables, compared on the same machine.

**Tech Stack:** TypeScript, Vitest 4 (projects `unit`, `dom`, `timing`), @testing-library/react, harper.js 2.13.0.

**Spec:** GitHub issues #10 and #32 (`gh issue view 10`, `gh issue view 32`). Owner decision 2026-11-03: #19 (reload Harper after a panic) moves to #13 (a background Worker). harper.js caches its WASM glue once per page, so a panicked instance can't be reloaded on the same page.

## Global Constraints

- Never damage the user's text: the backstop may only get stricter. Trust suite stays 79/79. The md5 of `deps/reports/decisions.md` stays `a0a3bdbd73b3211ee5c648ffc7584a84`. The zero-click count stays 41, and the tick counts in `tests/engine/neverDamage.test.ts` stay 8/10. If any of these move, stop and report; don't update the baseline.
- `src/engine` stays pure TypeScript (no DOM, `fs` or Tauri).
- Offsets are UTF-16 indices, end-exclusive.
- Owner's agent rules:
  - edit files only with the Write/Edit tools: no sed, awk, heredoc, python, shell redirection or shell rm;
  - tests first;
  - commit with `git commit -F <file>`, the message file in the scratchpad, never in the repo;
  - no Co-Authored-By or AI attribution;
  - no stash, reset, amend, push or branch switching;
  - one heavy command at a time;
  - no subagents.
- Test tiers (CLAUDE.md): `npm run test:changed` before each commit; the area script before review; `npm run trust` for `src/engine` changes.
- Commit messages: `type(scope): summary`. The commit that fixes the issue carries `Fixes #N` in its body.

## Review Focus

1. **A move across visible characters inside one token** ("ab‍c" becoming "a‍bc"). Expected: rejected. Pinned in Task 1.
2. **A removable invisible character deleted while whitespace changes in the same paragraph.** Expected: still accepted, so hygiene keeps working. Pinned in Task 1.
3. **Two identical joiners where only the removable one is deleted.** The anchor of the kept one must still match. Pinned in Task 1, and the existing F5 M-2 test must keep passing.
4. **The DOM suite under `test:release` load.** A lazily loaded dialog must not miss a `findBy*` wait. Covered by Task 2's repeated runs.
5. **A machine slower than the dev PC.** The 2,000-row test must not fail only on speed. It must still fail if the cost grows with the square of the rows again. Pinned in Task 2.

---

### Task 1: The backstop compares invisible characters' positions (#10)

**Files:**
- Modify: `src/engine/tokenGuard.ts`
- Test: `tests/engine/tokenGuard.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: the signatures of `keepsTokens(text, edits, removable)` and `editsChangingTokens(text, edits, removable)` don't change. They return `false` and the edit indexes more often.

**Rule.** An invisible character's anchor is the number of UTF-16 code units before it that are neither whitespace nor invisible. Whitespace changes leave it alone; moving text across the character changes it.
- Take the original text's anchors, as a list of `(character, anchor)` in order.
- Leave out the invisible characters the edits delete: those at offsets in `removable` that lie inside an edit's span.
- That list must equal the edited text's anchor list.
- Add this as a third condition in `keepsTokens`, next to the token comparison and `keepsInvisibles`.
- Update the file's header comment: "…and keeps every other invisible character between the same visible characters".

- [ ] **Step 1: Write the failing tests** in the `keepsTokens` describe block:

```ts
it('rejects an invisible character moved across visible ones, though the tokens match (#10)', () => {
  const text = 'ab‍c';
  const moved = [
    { paraId: 0, span: { start: 1, end: 2 }, replacement: '' },   // delete "b"
    { paraId: 0, span: { start: 3, end: 4 }, replacement: 'bc' }, // "c" -> "bc"
  ];
  expect(keepsTokens(text, moved, NONE)).toBe(false);
  expect(keepsTokens(text, moved, allInvisible(text))).toBe(false);
  expect(editsChangingTokens(text, moved, NONE)).toEqual([0, 1]);
});

it('rejects a word moved across a joiner between two words', () => {
  const text = 'one ​two three';
  // "one ​two three" -> "one two ​three": the ZWSP now sits after "two"
  const edits = [
    { paraId: 0, span: { start: 4, end: 8 }, replacement: 'two' },
    { paraId: 0, span: { start: 8, end: 9 }, replacement: ' ​' },
  ];
  expect(keepsTokens(text, edits, NONE)).toBe(false);
});

it('still allows deleting a removable invisible character while whitespace changes elsewhere', () => {
  const text = 'We​ went  home.';
  const edits = [...deleting(text, 2), edit(text, '  ', ' ')];
  expect(keepsTokens(text, edits, new Set([2]))).toBe(true);
});
```

(The second test's replacement adds an invisible character, so `keepsInvisibles` already rejects it. It stays as a guard on the combined behaviour. The first test is the RED one.)

- [ ] **Step 2: Run them and check they fail.**
Run: `npx vitest run tests/engine/tokenGuard.test.ts`
Expected: the first test FAILS (`keepsTokens` returns true); the other two pass.

- [ ] **Step 3: Implement the anchor comparison** in `src/engine/tokenGuard.ts`.
  - Add a private `invisibleAnchors(text: string, skip: ReadonlySet<number>): string[]`. It returns `"<char>@<anchor>"` for each invisible character whose offset is not in `skip`, iterating by code point.
  - In `keepsTokens`, the skip set is the offsets in `removable` that lie inside some edit's span. The edited text gets an empty skip set.
  - Reuse the existing `INVISIBLE` and `WHITESPACE` patterns; no new regex is needed beyond a single-character whitespace test, which is a named constant with an example comment.

- [ ] **Step 4: Run the file and the never-damage tests.**
Run: `npx vitest run tests/engine/tokenGuard.test.ts tests/engine/neverDamage.test.ts`
Expected: PASS, with tick counts 8/10 unchanged.

- [ ] **Step 5: Run the gates, one at a time.**
  - `npm run test:changed`: PASS.
  - `npm run test:engine`: PASS.
  - `npm run trust`: 79/79.
  - The decisions.md md5 is still `a0a3bdbd73b3211ee5c648ffc7584a84`, checked with `certutil -hashfile deps/reports/decisions.md MD5` or `md5sum`.

- [ ] **Step 6: Commit.** Use `fix(engine): token backstop rejects a moved invisible character`, with the body line `Fixes #10`.

---

### Task 2: Steady DOM and timing tests (#32)

**Files:**
- Modify: `tests/dom/setup.ts`
- Modify: `tests/timing/session.timing.test.ts` (the last test, "a 2,000-row, flag-heavy Markdown table…")
- Test: `tests/dom/setup.test.tsx` (new, one test)

**Interfaces:**
- Consumes: none.
- Produces: none.

**Why.** The About tests open a lazily imported dialog and wait for it with `findBy*`, whose default limit is 1,000 ms. Under `test:release` load, that import can take longer. The 2,000-row test has an absolute 20 s budget against about 10 s alone on the dev PC, so it fails on slower or busy machines. What it guards against is a return to cost that grows with the square of the rows: this table once took 30–43 s.

- [ ] **Step 1: Write the failing setup test** in `tests/dom/setup.test.tsx`:

```ts
import { it, expect } from 'vitest';
import { getConfig } from '@testing-library/react';

it('waits up to 5 s for elements that load on demand (#32: lazily imported dialogs under full-suite load)', () => {
  expect(getConfig().asyncUtilTimeout).toBe(5000);
});
```

Run: `npx vitest run --project dom tests/dom/setup.test.tsx`. Expected: FAIL (1000).

- [ ] **Step 2: In `tests/dom/setup.ts`, call `configure({ asyncUtilTimeout: 5000 })`**, imported from `@testing-library/react`. Add a one-line comment giving the reason above. Rerun the setup test: PASS.

- [ ] **Step 3: Replace the absolute budget in the 2,000-row test with a relative one.** The owner wants 200, 500 and 1,000-row tables measured as well, since tables of those sizes are realistic on a busy machine.
  - Build the table with a helper `tableOf(rows: number)`, using the same row text as today.
  - Check a 200-row table once as a warm-up and discard that run.
  - Time checks of 200, 500, 1,000 and 2,000 rows, in that order. For each size, compute the time per row: `ms / rows`.
  - Assert:
    - the 2,000-row session has `session.candidates().length > 10_000` (unchanged);
    - for each of 500, 1,000 and 2,000 rows, its time per row is under 2.5× the 200-row time per row. Growth in line with the rows keeps this near 1×; growth with the square of the rows would reach 2.5× at 500 rows and 10× at 2,000.
    - Assert all sizes in one `expect` on an object such as `{ 500: true, 1000: true, 2000: true }`, so a failure shows every size. The task report lists the measured times.
  - Name the test "a flag-heavy Markdown table's time per row stays flat from 200 to 2,000 rows (no square-of-rows growth)".
  - Keep the 120,000 ms test timeout as the overall ceiling.
  - Update the comment block above the test: it gives the 30–43 s history and says the budget is relative so a slower or busy machine passes.

- [ ] **Step 4: Run the timing project alone.**
Run: `npx vitest run --project timing`
Expected: PASS. Report the four timings and the time-per-row ratios in the task report.

- [ ] **Step 5: Run the gates, one at a time.**
  - `npm run test:changed`: PASS.
  - `npm run test:dom`: PASS, run twice in a row. Both runs pass with no About-dialog timeout.

- [ ] **Step 6: Commit.** Use `test: steady About-dialog waits and a relative 2,000-row budget`, with the body line `Fixes #32`.

---

## After the tasks (controller, not a task)

1. Final whole-plan review.
2. Release gates, one at a time:
   - `npm run test:release` twice; both green;
   - `npm run trust`, 79/79;
   - `npm run upgrade:check`.
3. Ask the owner before the release steps:
   - bump to 1.2.1: package.json/lock, tauri.conf.json, Cargo.toml/lock, docs/INSTALL.md and the six version-pinned tests;
   - `npm run release`;
   - fast-forward `main` and push both branches;
   - post closing comments on #2, #10 and #32, and a comment on #19 pointing to #13;
   - run `gh release create v1.2.1`;
   - watch the web deploy.
