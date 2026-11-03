# Harper in a Worker (v1.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Harper in a Web Worker in the desktop app and the web version, so the page never blocks on linting, and replace the Worker after a crash so only the paragraph that crashed is marked "Not checked" (#19, and #13 part 1).

**Architecture:** The app reaches Harper only through the `RulesLinter` interface (`src/engine/linter.ts`), built by `createAppLinter` in `src/ui/platform/linter.ts` (desktop) and `src/ui/platform-web/linter.ts` (web). A new `src/ui/linterWorker/` module provides that same interface:
- the worker side wraps the existing `createLinter` and answers messages;
- the main-thread side forwards each call to it. When a call fails, or the Worker dies, the main side terminates it, starts a fresh one, and replays the variant and every added word.

`src/engine`, CheckSession and the Node paths (CLI, tests, trust) are unchanged. They keep the in-process linter.

**Tech Stack:** TypeScript, Vite 8 module workers (`new Worker(new URL(…, import.meta.url), { type: 'module' })`), harper.js 2.13.0 (`harper.js/binary`), Vitest 4.

**Spec:**
- GitHub #19: "a forced panic affects one paragraph only, and later paragraphs are checked".
- GitHub #13, part 1: "the UI stays responsive on a very long document, and the rules pass stays under 300 ms for 1,500 words".
- Owner decision, 2026-11-03: v1.3.0 is the Worker plus crash recovery only. #13 stays open for "visible paragraphs first", and its Intl.Segmenter item moves to #1.
- Why a Worker: harper.js caches its WASM glue once per page (a `pMemoize` on the URL, and wasm-bindgen's module-level `wasm`), so a panicked instance can't be reloaded in the same realm. A fresh Worker is a fresh realm.

## Global Constraints

- Never damage the user's text. Candidates must reach the session exactly as the in-process linter makes them: same ids, spans, replacements, kinds and messages, in the same order. The tests compare them field by field.
- `src/engine` stays pure: no `Worker`, DOM or Tauri there. Worker code lives in `src/ui/linterWorker/`.
- The CSP stays as it is. The desktop CSP (`src-tauri/tauri.conf.json`) has `default-src 'self'`, and the web CSP (`scripts/webBuild.ts`) has `worker-src 'self'`. Both already allow a same-origin module worker. Don't loosen either one.
- The web build must keep exactly one `harper_wasm_bg-*.wasm`. The loading screen pre-downloads `binary.url` (`src/ui/web/harperWasm.ts`), so the Worker's Harper must fetch the same URL, or users download about 19 MB twice.
- No new dependency.
- Owner's agent rules:
  - edit files only with the Write/Edit tools: no sed, awk, heredoc, python, shell redirection or shell rm;
  - tests first;
  - commit with `git commit -F <file>`, the message file in the scratchpad, never in the repo;
  - no Co-Authored-By or AI attribution;
  - no stash, reset, amend, push or branch switching;
  - one heavy command at a time;
  - no subagents.
- Test tiers (CLAUDE.md): `npm run test:changed` before each commit; `npm run test:ui` and `npm run test:web` before handing back.
- Commit messages: `type(scope): summary`. The commit that completes #19 carries `Fixes #19` in its body, and `Refs #13`.

## Review Focus

1. **A crash mid-chunk.** `lintInChunks` retries the chunk one paragraph at a time. Each retry must go to a fresh Worker, so only the crashing paragraph is reported unchecked. Pinned in Task 1.
2. **Words added after start** (dictionary additions, the terms card) and a changed variant must survive a restart. Otherwise the fresh Worker flags words the user already accepted. Pinned in Task 1.
3. **A Worker that dies without answering** (out of memory, script error) must reject its pending calls, never hang, and the next call must get a fresh Worker. Pinned in Task 1.
4. **A check superseded mid-lint** (the user types while a long check runs): replies must match their requests by id. A late reply to an old request must not resolve a newer one. Pinned in Task 1.
5. **The web build.** Exactly one wasm file, the worker chunk precached, and no Harper code in the main chunk. Pinned in Task 2.

---

### Task 1: The worker linter and its restart rule

**Files:**
- Create: `src/ui/linterWorker/protocol.ts` (the message types)
- Create: `src/ui/linterWorker/serveLinter.ts` (the worker side, testable without a Worker)
- Create: `src/ui/linterWorker/workerLinter.ts` (the main-thread side)
- Test: `tests/ui/workerLinter.test.ts`

**Interfaces:**
- Consumes: `RulesLinter` and `createLinter(variant, words, opts)` from `src/engine/linter.ts` (unchanged).
- Produces:
  - `type LinterRequest = { id: number } & ({ op: 'start'; variant: Variant; words: string[] } | { op: 'lintParagraphs'; paras: Paragraph[]; language: 'plaintext' | 'markdown' } | { op: 'lintSpelling'; paras: Paragraph[]; variant: Variant } | { op: 'addWords'; words: string[] } | { op: 'setVariant'; variant: Variant })`
  - `type LinterReply = { id: number; ok: true; candidates?: Candidate[] } | { id: number; ok: false; message: string }`
  - `serveLinter(create: (variant: Variant, words: string[]) => Promise<RulesLinter>): (request: LinterRequest) => Promise<LinterReply>`. It never throws: a thrown error becomes `{ ok: false, message }`.
  - `interface WorkerLike { postMessage(message: LinterRequest): void; terminate(): void; onmessage: ((event: { data: LinterReply }) => void) | null; onerror: ((event: unknown) => void) | null }`
  - `createWorkerLinter(variant: Variant, words: string[], makeWorker: () => WorkerLike): Promise<RulesLinter>`

**Restart rule.** Any failed reply (`ok: false`), and any `onerror`, makes the main side do four things:
1. reject every pending call: the failed one with its message, the others with "The proofreader restarted; this check was interrupted";
2. terminate the Worker;
3. create a fresh one;
4. send it `start` with the current variant and all words: the initial ones plus every `addWords` so far.

The failed call still rejects, so `lintInChunks` reports that paragraph unchecked. Later calls go to the fresh Worker. `variant` reads the last value passed to `setVariant`.

- [ ] **Step 1: Write the failing tests** in `tests/ui/workerLinter.test.ts`. Use an in-process fake: `fakeWorker(create)` returns a `WorkerLike` whose `postMessage` runs `serveLinter(create)` asynchronously and calls `onmessage` with the reply.
  - `'gives the session the same candidates as the linter itself'`:
    - real `createLinter('American')` behind the fake;
    - paragraphs `[{ id: 0, text: 'I recieved teh letter.' }, { id: 1, text: 'We met on Tuesday.' }]`;
    - `toEqual` the direct `createLinter('American')` result, for both `lintParagraphs(paras, 'plaintext')` and `lintSpelling(paras, 'British')`.
  - `'after a crash on one paragraph, a fresh worker checks the next ones (#19)'`. The fake linter's `lintParagraphs` throws `RuntimeError('unreachable')` on any paragraph containing `PANIC` and on every call after that, as Harper does. Run `lintInChunks([{id:0,text:'fine one'},{id:1,text:'PANIC here'},{id:2,text:'fine two'}], …)` through the worker linter. Expect:
    - unchecked `[1]`;
    - results for paragraphs 0 and 2;
    - `makeWorker` called 3 times: start, the chunk failure, the single-paragraph failure.
  - `'a fresh worker gets the current variant and every word added so far'`:
    - start with `('British', ['kashiro'])`;
    - call `addWords(['culicifacies'])` and `setVariant('Indian')`;
    - force a failure;
    - the new worker's `start` request equals `{ op: 'start', variant: 'Indian', words: ['kashiro', 'culicifacies'] }`.
  - `'a worker that dies fails its pending calls and the next call starts a fresh one'`:
    - `onerror` fires while a `lintParagraphs` is pending;
    - that call rejects;
    - the next call resolves on worker 2.
  - `'a late reply never answers a newer request'`. Deliver replies out of order (the fake delays the first). Each promise resolves with its own candidates.

- [ ] **Step 2: Run them; they fail** (the modules don't exist).
Run: `npx vitest run tests/ui/workerLinter.test.ts`

- [ ] **Step 3: Implement** `protocol.ts`, `serveLinter.ts` and `workerLinter.ts`.
  - Request ids come from a counter. Pending calls live in a `Map<number, { resolve, reject }>`.
  - `createWorkerLinter` resolves once `start` has succeeded. If the first `start` fails, it rejects with that message: the app already shows `error.checkerStart`.
  - Restarts happen one at a time: calls made while a restart's `start` is pending wait for it.
  - The restart error message is one line a user could act on. The app shows it through the existing unchecked-paragraph path, not as a new banner.
  - Files stay small: each one well under ~150 lines.

- [ ] **Step 4: Run the tests; they pass.** `npx vitest run tests/ui/workerLinter.test.ts`

- [ ] **Step 5: Gates, one at a time:** `npm run test:changed`, then `npm run test:ui`.

- [ ] **Step 6: Commit.** Use `feat(ui): worker linter that restarts after a crash`, with the body `Refs #19`.

---

### Task 2: Wire it into the desktop app and the web version

**Files:**
- Create: `src/ui/linterWorker/harperWorker.ts` (the worker entry)
- Modify: `src/ui/platform/linter.ts`, `src/ui/platform-web/linter.ts`
- Modify: `vite.config.ts`, only if Vite needs `worker: { format: 'es' }` for a module worker that imports wasm
- Test: `tests/web/workerBuild.test.ts` (new; it reads the built site in `dist-web/`, the output of `npm run build:web`)

**Interfaces:**
- Consumes: `serveLinter`, `createWorkerLinter` and `WorkerLike` from Task 1.
- Produces: `createAppLinter(variant, words)`, with the same signature as today. Both platforms return `createWorkerLinter(variant, words, () => new Worker(new URL('../linterWorker/harperWorker.ts', import.meta.url), { type: 'module' }))`.

- [ ] **Step 1: Write `harperWorker.ts`.**
  - `self.onmessage = async (e) => self.postMessage(await handle(e.data))`, where `handle = serveLinter((v, w) => createLinter(v, w, { binary }))` and `binary` comes from `harper.js/binary`.
  - Add one comment: the worker exists so a panicked Harper can be replaced (#19), and keeps linting off the page's thread (#13).

- [ ] **Step 2: Switch both `createAppLinter`s** to the worker linter.
  - Keep one shared helper so the two files don't duplicate the `new Worker(…)` line, e.g. `appWorker()` in `src/ui/linterWorker/appWorker.ts`.
  - Update both files' comments.

- [ ] **Step 3: Write the failing build test** `tests/web/workerBuild.test.ts`. It skips with a clear message when the built site is missing. Against the built site it asserts:
  - exactly one file matches `/^assets\/harper_wasm_bg-.*\.wasm$/`;
  - a worker chunk (`assets/harperWorker-*.js`) exists and is listed in `precache.json` `files`;
  - the main entry chunk does not contain the string `harper_wasm_bg` other than through the URL import. If that can't be asserted reliably, record the main and worker chunk sizes in the report instead.

  Run `npm run build:web`, then the test.

- [ ] **Step 4: Fix the build until the test passes.** Expected work is the Vite worker format, and checking that `ON_FIRST_USE` in `scripts/webBuild.ts` still matches the one wasm file.

- [ ] **Step 5: Gates, one at a time:**
  - `npm run test:changed`;
  - `npm run test:web`;
  - `npm run test:dom` (the app's DOM tests mock `platform/linter`, so they must stay green unchanged);
  - `npm run build:web`;
  - `npx tauri build --debug --no-bundle`, which must build.

- [ ] **Step 6: Commit.** Use `feat(ui): Harper runs in a worker on the desktop and the web`, with the body `Fixes #19` and `Refs #13`.

---

## After the tasks (controller, not a task)

1. **A browser pass on the web build** (`npm run build:web` + `npx vite preview`), using Chrome DevTools. Check that:
   - a Worker is running;
   - the main thread shows no long task while a 2,000-row table is checked;
   - the network shows one wasm download;
   - check, accept and undo work.
2. **A forced crash in that browser.** From the DevTools console, terminate the worker mid-check, then check that later paragraphs are still checked.
3. **A desktop pass:** the owner tests the debug build.
4. **Release gates:**
   - `npm run test:release`;
   - `npm test`;
   - `npm run trust`;
   - `npm run upgrade:check`.
5. **Ask the owner before the release steps** (v1.3.0):
   - bump the version and the six pinned tests;
   - `npm run release`;
   - fast-forward `main` and push;
   - post the closing comment on #19 and a progress comment on #13;
   - `gh release create`;
   - watch the web deploy.
