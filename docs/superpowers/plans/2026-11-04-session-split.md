# Split `session.ts` (#33) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `src/engine/session.ts` (724 lines, one class) into modules with one responsibility each, with no behaviour change, and release it as v1.3.2.

**Architecture:** `CheckSession` stays the only public interface: same class, same public methods and signatures, same `engine/session` exports (68 files import it). Its private fields that the modules share move into one internal `SessionState` record. Each new module exports plain functions taking that record (`rankDecisions(s)`, `undo(s, id)`), and the class methods become one-line delegations. Queries that read only the session's own fields stay in the class.

**Tech Stack:** TypeScript, Vitest.

**Spec:** GitHub issue #33 ("Split it by responsibility into smaller modules… Acceptance: no behaviour change, all tests pass, and each file has one clear responsibility.") and `CLAUDE.md` § Structure.

## Global Constraints

- No behaviour change. **No file under `tests/` changes**, except new tests explicitly listed in a task.
- `CheckSession`'s public surface is unchanged: every public method, getter and readonly field keeps its name, parameters and return type. `engine/session` keeps re-exporting `TRACKED_CHANGE_REASON`, `REWRITE_OUT_OF_DATE`, `CheckOptions`, `Edit`, `LogEntry`, `Outcome`, `SessionDeps`, `Status`.
- `SessionState` and the new modules are engine-internal: nothing outside `src/engine/session*.ts` imports them.
- Every file in `src/engine/session*.ts` stays at or under ~300 lines; `session.ts` ends at or under 300.
- `src/engine` stays pure TypeScript: no `fs`, DOM or Tauri imports (`tests/engine/layering.test.ts` checks this).
- Move code verbatim: keep doc comments with the code they describe, keep statement order, and change `this.x` to `s.x` and nothing else. Any line that is not a pure move gets a one-line reason in the task report.
- Commit messages: `refactor(engine): …`. No `Co-Authored-By` or AI attribution.
- Test tiers: `npm run test:changed` before each commit; `npm run test:engine` and `npm run trust` before each task's review (the change is under `src/engine`); `npm run test:release`, `npm run trust` and `npm run upgrade:check` before release. If DOM tests flake under full-suite load, rerun the failing files alone, then the full suite.

## Review Focus

These are the risks of the move, in order of likelihood. Each task's reviewer checks the ones in its files.

1. **Side-effect order changes.** `applyBatch` applies and *then* takes a batch id. `undo` deletes `batchOf` before recording. `addWord` awaits each engine before rejecting flags. A reordered statement gives a different log or status. Check: the diff of each moved body against the original shows only `this.` → `s.` (Task 1 Step 1 saves the original for this).
2. **Cached decisions.** `onWordCard`, `resolve`, `acceptCard` and `rankedDecisionCount` each call `decisions()` fresh, because statuses change between calls. A module that computes decisions once and reuses them would serve stale cards. Check: no module-level or state-level cache of `rankDecisions` output.
3. **Rewrite host closures.** `HelperRewrites` gets callbacks (`applyOne`, `accept`, `reject`, `addCandidate`) that must reach the same state record the class uses, built before the first candidate is added. Check: the constructor creates `SessionState` first, then `rewrites`, then assigns it (Task 1 Step 3).
4. **Primitive fields copied by value.** `batchCount` and `reviewDepth` are numbers or strings. If a module takes them as a parameter instead of reading `s.batchCount` / `s.reviewDepth`, its updates are lost. Check: they are read and written only through `s`.
5. **Reaching inside from outside.** If a UI file or test imports `sessionEdits`, the module becomes public API by accident. Check: `git grep -n "sessionState\|sessionDecisions\|sessionEdits\|sessionIntake\|sessionDictionary" -- src tests` lists only `src/engine/session*.ts` (plus the one new test in Task 1).

---

### Task 1: Shared state and decision ranking

Settles the shape every later task uses.

**Files:**
- Create: `src/engine/sessionState.ts`, `src/engine/sessionDecisions.ts`
- Modify: `src/engine/session.ts` (fields 59–91, constructor 93–131, `CARD_ACCEPT_METHODS` 51–56, `decisions` 220–264, `spellingFlagSpans` 270–279, `onWordCard` 303–306, `decisionCount`/`rankedDecisionCount` 314–327, `members`/`resolve` 705–723)
- Test: `tests/engine/sessionInternals.test.ts` (new, one test)

**Interfaces:**
- Produces, in `sessionState.ts`:

```ts
/** CheckSession's private state, shared by its modules (session*.ts). Not an API: nothing else imports it. */
export interface SessionState {
  readonly paras: Map<number, Paragraph>;
  readonly cands: Map<string, Candidate>;
  readonly tiers: Map<string, Tier>;
  readonly ledger: EditLedger;
  readonly ctx: TierContext;
  readonly userRejected: Set<string>;
  readonly unplaceable: Map<string, string>;
  readonly typoWords: Set<string>;
  readonly optedIn: Set<string>;
  readonly alignedParas: Set<number>;
  readonly batchOf: Map<string, string>;
  readonly added: string[];
  readonly words: number;
  readonly termMinRepeats: number;
  batchCount: number;
  reviewDepth: ReviewDepth;
  engines: readonly LanguageEngine[];
  rewrites: HelperRewrites;
}
```

- Produces, in `sessionDecisions.ts`:
  - `export const CARD_ACCEPT_METHODS: Map<string, { name: string; method: string }>` (moved as is)
  - `export function rankDecisions(s: SessionState): { top: Decision[]; more: Decision[] }` (body of `decisions()` plus the private `spellingFlagSpans`, which stays module-private; `this.modules` becomes `{ ...(s.ctx.modules ?? DEFAULT_MODULES) }`)
  - `export function resolveDecision(s: SessionState, id: string): { ownerId: string; members: Candidate[] }`
  - `export function decisionMembers(s: SessionState, id: string): Candidate[]`
  - `export function isOnWordCard(s: SessionState, candidateId: string): boolean`
  - `export function countRankedDecisions(s: SessionState): number`

- [ ] **Step 1: Save the original for the move check**

Run: `git show HEAD:src/engine/session.ts > .superpowers/sdd/2026-11-04-session-split/session.before.ts`. Reviewers diff moved bodies against this file. The folder is gitignored.

- [ ] **Step 2: Write the boundary test**

`tests/engine/sessionInternals.test.ts`, test `the session modules are engine-internal`. It lists every file under `src` and `tests` (recursively, using `node:fs`, as `layering.test.ts` does), and asserts that the only files whose imports match `/from '.*\/session(State|Decisions|Edits|Intake|Dictionary)'/` are under `src/engine/` with a basename starting with `session`. It passes now (no such modules yet) and guards Review Focus 5 from here on.

- [ ] **Step 3: Create `SessionState` and move ranking**

In the class, replace the fields listed in the interface with `private readonly s: SessionState`. Fields only the class reads stay as class fields: `paraNumber`, `unchecked`, `otherScript`, `paragraphEngines`, `proofreader`, `passages`, `latinText`. In the constructor, build the state record first. Then create `HelperRewrites`, whose host closures read `this.s`. Then assign `this.s.rewrites`. To type the gap, build the record as a local variable without `rewrites`, create the rewrites, and assign the full record (`{ ...partial, rewrites }`, not `Object.freeze`: `batchCount` and `reviewDepth` change) to `this.s`. The closures must read `this.s`, never the partial record. Don't use `!` on a field. `start()` sets `this.s.engines`. `decisions()`, `onWordCard()`, `decisionCount()`, `rankedDecisionCount()` and the private `members`/`resolve` call the new functions; `depth`/`setDepth`/`modules` read and write `this.s`.

- [ ] **Step 4: Verify**

Run: `npm run test:engine` → all green, the same count as before plus 1. Run `npm run trust` → passes. Run `npm run test:changed` → green. Then `wc -l src/engine/sessionDecisions.ts src/engine/sessionState.ts` → each under 300.

- [ ] **Step 5: Commit**

```bash
git add src/engine/session.ts src/engine/sessionState.ts src/engine/sessionDecisions.ts tests/engine/sessionInternals.test.ts
git commit -m "refactor(engine): move session decision ranking into sessionDecisions (#33)"
```

---

### Task 2: Applying, undoing and taking in candidates

**Files:**
- Create: `src/engine/sessionIntake.ts`, `src/engine/sessionEdits.ts`
- Modify: `src/engine/session.ts` (`HELD_BACK_REASON`, `RESTORED_INVISIBLE_REASON`, `accept`, `applyBatch`, `undoBatch`, `applyMembers`, `withdrawOutdated`, `coversRestoredInvisible`, `reject`, `ignoreAll`, `undo`, `holdBackUndone`, `addCandidates`, `sessionTier`, `markUnplaceable`, `autoApply`, `holdBackChangedTokens`, `holdBack`, `hygieneRemovable`)

**Interfaces:**
- Consumes: `SessionState`, `resolveDecision`, `decisionMembers`, `CARD_ACCEPT_METHODS` (Task 1).
- Produces, in `sessionIntake.ts` (candidates entering the session, and changes made without a click):
  - `export function addCandidates(s: SessionState, cs: Candidate[]): void` (with the private `sessionTier`)
  - `export function autoApply(s: SessionState): void`
  - `export function holdBackChangedTokens(s: SessionState): void` (with the private `hygieneRemovable` and `HELD_BACK_REASON`)
  - `export function holdBack(s: SessionState, candidateId: string, reason: string): void`
- Produces, in `sessionEdits.ts` (the user's actions on candidates):
  - `export function applyMembers(s: SessionState, decisionId: string, members: Candidate[], replacementIndex: number): void` (with the private `coversRestoredInvisible` and `RESTORED_INVISIBLE_REASON`)
  - `export function applyBatch(s: SessionState, decisionId: string, candidateIds: string[] | undefined, replacementIndex: number): string`
  - `export function newBatchId(s: SessionState): string` returns `` `batch-${++s.batchCount}` ``, used by `applyBatch` and the rewrites host `newBatch`
  - `export function undoBatch(s: SessionState, batchId: string): void`
  - `export function undo(s: SessionState, candidateId: string): void`
  - `export function rejectDecision(s: SessionState, decisionId: string): void`
  - `export function holdBackUndone(s: SessionState, candidateId: string): void`
  - `export function markUnplaceable(s: SessionState, candidateId: string, reason: string): void`
  - `export function withdrawOutdated(s: SessionState): void`

`sessionEdits` imports `holdBack` from `sessionIntake`; `sessionIntake` imports nothing from `sessionEdits`.

- [ ] **Step 1: Move the bodies**

Move each body verbatim as specified in Global Constraints. The class methods `accept`, `applyBatch`, `undoBatch`, `reject`, `ignoreAll`, `undo`, `holdBackUndone`, `addCandidates` and `markUnplaceable` keep their doc comments and become one-line delegations. `start()` calls `addCandidates(this.s, found)`, `autoApply(this.s)` and `holdBackChangedTokens(this.s)` in that order. The rewrites host closures `applyOne`, `addCandidate`, `newBatch`, `accept` and `reject` call the new functions or the class methods, with the same effect as before.

- [ ] **Step 2: Verify**

Run `npm run test:engine`, `npm run trust` and `npm run test:changed`: all green. Also run `npx vitest run tests/ui/sessionController.test.ts tests/ui/sessionStore.test.ts` (the UI's heaviest session users): green.

- [ ] **Step 3: Commit**

```bash
git add src/engine/session.ts src/engine/sessionIntake.ts src/engine/sessionEdits.ts
git commit -m "refactor(engine): move applying and undoing edits out of session.ts (#33)"
```

---

### Task 3: Dictionary and word cards; final size check

**Files:**
- Create: `src/engine/sessionDictionary.ts`
- Modify: `src/engine/session.ts` (`addToDictionary`, `acceptNames`, `acceptTerms`, `acceptOtherLanguage`, `acceptCard`, `addWord`, `addTypedWord`)

**Interfaces:**
- Consumes: `SessionState`, `rankDecisions`, `decisionMembers` (Task 1); `undo` (Task 2).
- Produces, in `sessionDictionary.ts`:
  - `export async function addWord(s: SessionState, written: string): Promise<void>`
  - `export async function addFlaggedWord(s: SessionState, decisionId: string): Promise<void>` (the body of `addToDictionary`)
  - `export async function acceptWordCard(s: SessionState, kind: 'names' | 'terms' | 'otherLanguage', keepAsTypos: string[], alsoTypos?: (card: Decision) => string[]): Promise<void>`

`acceptOtherLanguage`'s ticked-likely-typos filter stays in the class method, which passes it as `alsoTypos`. The class methods keep their doc comments; `addedWords()` stays a class query reading `this.s.added`.

- [ ] **Step 1: Move the bodies**

Move each body verbatim as specified in Global Constraints.

- [ ] **Step 2: Check the end state**

- Run `wc -l src/engine/session*.ts`: every file is at or under ~300 lines, and `session.ts` is at or under 300. If `session.ts` is over 300, say so in the report with the count; don't move more code to hit the number.
- Run `git diff <Task 1 base>..HEAD --stat -- tests`: only `tests/engine/sessionInternals.test.ts`.
- Run `git grep -n "^  [a-zA-Z].*(.*).*{$\|^  get \|^  static " src/engine/session.ts` and the same on `session.before.ts`: the public method lines match, ignoring `private` ones.

- [ ] **Step 3: Verify**

Run `npm run test:engine`, `npm run trust` and `npm run test:changed`: all green.

- [ ] **Step 4: Commit**

```bash
git add src/engine/session.ts src/engine/sessionDictionary.ts
git commit -m "refactor(engine): move dictionary and word cards out of session.ts" -m "Fixes #33"
```

---

### Release v1.3.2 (controller, after the final whole-branch review)

- [ ] Run `/simplify` on the branch's changes (CLAUDE.md milestone rule). It may only tidy within the new files; a behaviour change fails the constraints.
- [ ] Release gates: `npm run test:release`, `npm run trust`, `npm run upgrade:check`.
- [ ] Bump the version to 1.3.2 in `package.json`/`package-lock.json`, `tauri.conf.json`, `Cargo.toml`, `INSTALL.md` and the 6 version-pinned tests. Commit as `chore(release): 1.3.2`.
- [ ] Push `v1.0-dev`; build the assets; fast-forward `main`; publish the GitHub release (notes: "Internal: `session.ts` split into smaller modules. No change in behaviour."). Confirm the web deploy, then add a closing comment on #33.
