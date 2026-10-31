# Kashiro on the web: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a static web build of Kashiro (the full app, without AI), deployed to GitHub Pages as a preview, that shares the engine and UI with desktop and changes text exactly as desktop does.

**Architecture:**
- `src/ui/platform/*` (Tauri) gets a twin, `src/ui/platform-web/*`, which exports the same names and is chosen at build time.
- A `capabilities` object from the platform hides desktop-only UI.
- The web build is a plain static folder (`dist-web/`) with a CSP meta tag, a hand-written service worker and a web manifest.

**Tech stack:** Vite 8 (rolldown), React, TypeScript, harper.js (WASM), the File System Access API with a download fallback, IndexedDB, the Web Speech API, and GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-10-30-kashiro-web-design.md`. Read it first; this plan argues from it.

## Global constraints

- **Owner's rules for implementers:**
  - Edit with Write/Edit only. **No sed in any form, even read-only** (read with Read/Grep). No heredocs, no Python, including scratch scripts.
  - Commit with `git commit -F <file written with Write>`. **No Co-Authored-By trailer or any AI attribution.**
  - No `git stash`, worktree, reset, rm/del, `update-index`, `hash-object` or `filter-branch`. Never `taskkill /IM`.
  - **No downloads and no new npm or cargo dependency** without the controller's OK.
  - Run heavy commands (`npm test`, trust, timing, cargo, upgrade:check, the builds) **one at a time**.
  - Every fix gets a test that fails first. Follow CLAUDE.md.
- **The desktop build must be byte-for-byte unaffected in behaviour:**
  - all existing tests pass;
  - trust ticks stay at 8 reference / 10 corpus, zero-click at 41;
  - the decisions.md md5 stays `a0a3bdbd73b3211ee5c648ffc7584a84`;
  - `npm run release` still works.
- **No web code in the desktop bundle, and no Tauri imports in the web bundle.** Verify it by grepping the built output.
- **The web build never sends document text, file names or dictionary words off the device:**
  - no analytics, cookies, third-party scripts or fonts;
  - read-aloud uses only `voice.localService === true` voices.
- **GitHub Pages base path:** `/kashiro/` by default, overridable with the `KASHIRO_WEB_BASE` env variable (`/` for Cloudflare or a custom domain).
- **Save matches desktop:** it suggests the `.checked` sibling name, and only the Overwrite setting suggests the original name, with the copy "No backup on the web: the original is replaced". Saved bytes must be identical to desktop for the same review.
- **The UI is labelled "Preview"** until the owner says otherwise.
- **i18n:** every new string in en, hi and bn. List the hi/bn drafts for native review in the task report.

## Review focus

1. **Browser storage that's unavailable or full** (Firefox/Safari private windows, a full quota). Expected: the app still checks and saves files. Settings, the dictionary and saved reviews stay in memory for the session, with one notice "This browser isn't keeping Kashiro's settings". Nothing crashes. Covered in Task 2.
2. **Two Kashiro tabs open at once.** Expected: the last write wins for settings, and a dictionary word added in one tab is never lost by the other tab saving stale settings. The dictionary merges on save, re-reading before writing. Covered in Task 2.
3. **Text dropped or pasted that's huge (over the 2 MB limit), or a dropped unsupported file (.pdf).** Expected: the same "too large" or "can't open this kind of file" notice as desktop. No freeze, and the current document stays open. Covered in Task 3.
4. **No on-device voice** (Chrome on Linux or Mac with only network voices). Expected: read-aloud shows "No offline voice is installed". Network voices are never listed or used, even as a fallback. Covered in Task 4.
5. **Offline, or a new version deployed mid-review.** Expected: after the first visit the app loads offline. A new deploy shows "Updated, reload" and never reloads by itself while a document is open. Covered in Task 5.

---

### Task 1: The platform switch and capabilities

**Files:**
- Create: `src/ui/platform/capabilities.ts` and `src/ui/platform-web/capabilities.ts`
- Create: `src/ui/platform/window.ts`. It moves the `getCurrentWindow` uses out of `App.tsx` and `useShowWindowWhenDrawn.ts`, so no Tauri import remains outside `src/ui/platform`.
- Create: `src/ui/platform-web/*`, one file per `src/ui/platform/*` file with the same exports. For now it's stubs that throw `new Error('not available on the web yet')`, except `capabilities` and `window`, which are real.
- Modify: `vite.config.ts`. When `KASHIRO_TARGET=web`:
  - resolve every import of `src/ui/platform/<x>` to `src/ui/platform-web/<x>`, with a small resolver plugin or an alias;
  - set `base` from `KASHIRO_WEB_BASE` (default `/kashiro/`);
  - set `outDir: 'dist-web'`.
- Modify: `package.json`, adding `"build:web": "tsc && tsx scripts/build-web.ts"`. `scripts/build-web.ts` sets `KASHIRO_TARGET=web` and `VITE_BUILD_DATE`, then calls Vite's `build()` API. **No new dependency.**
- Modify: `.gitignore` (add `dist-web/`).
- Test: `tests/platform/parity.test.ts` and `tests/ui/capabilities.test.tsx`.

**Interfaces, produced:**
- `capabilities` in both platforms, with exactly this type:
  ```ts
  export interface Capabilities { ai: boolean; windowMemory: boolean; updates: boolean; textDrop: boolean; saveInPlace: 'native' | 'picker' | 'download'; web: boolean }
  ```
  - Desktop: `{ ai: true, windowMemory: true, updates: true, textDrop: false, saveInPlace: 'native', web: false }`.
  - Web: `{ ai: false, windowMemory: false, updates: false, textDrop: true, saveInPlace: 'showSaveFilePicker' in window ? 'picker' : 'download', web: true }`.
- `window.ts` in both platforms exports `showMainWindow(): Promise<void>` and `setWindowTitle(title: string): Promise<void>`. On the web, the title sets `document.title` and showing the window does nothing.

**Steps:**
- [ ] **Step 1. Failing test, `parity.test.ts`:** for every file in `src/ui/platform/`, the same-named file exists in `src/ui/platform-web/`, and `Object.keys(await import(desktop)).sort()` equals that of the web twin. Mock `@tauri-apps/*` modules with `vi.mock`. Also assert that no file outside `src/ui/platform/` imports `@tauri-apps` (read the files with `fs` and match `/@tauri-apps\//`).
- [ ] **Step 2. Failing test, `capabilities.test.tsx`:** render the app with a web `capabilities` (mock the module), and assert that:
  - the ⋯ menu has no "Check for updates…";
  - Settings has no AI module toggles and no model-file setting;
  - the About text includes the new en string `about.webAi`, "AI rewrites are available in the desktop app".

  With the desktop capabilities, all of them are present, as today.
- [ ] **Step 3.** Run both tests and see them fail.
- [ ] **Step 4.** Implement the files above, and gate the UI items on `capabilities` (`Toolbar`/`MoreMenu`, `SettingsPanel` modules and AI, `AboutDialog`, `App` window memory, the palette entries). Add `about.webAi` and `about.preview` ("Preview") in en/hi/bn.
- [ ] **Step 5.** Run the two tests, then `npx tsc --noEmit -p .`, then `npm test` (one at a time). All pass.
- [ ] **Step 6.** Run `npx tsx scripts/build-web.ts`. It builds `dist-web/` (the stubs may throw at runtime; that's fine for now). `rg -l "@tauri-apps" dist-web` finds nothing, and `rg -l "platform-web" dist` (after `npm run build`) finds nothing.
- [ ] **Step 7.** Commit: `feat(web): platform switch and capabilities for a web build`.

### Task 2: Web storage (settings, saved reviews, dictionary export and import)

**Files:**
- Create: `src/ui/platform-web/storage.ts`, one IndexedDB database `kashiro` with object stores `settings` and `sessions`. Fall back to an in-memory `Map` when `indexedDB` is missing or `open` fails (Review focus 1). It exports `storageIsPersistent(): boolean`.
- Implement: `src/ui/platform-web/settings.ts` (`loadSettings`, `saveSettings`) and `src/ui/platform-web/sessions.ts` (`sessionFiles`, with the same `SessionFiles` contract as desktop, `prune(keepDays)` included).
- Modify: the Settings › Saving tab gets **Export dictionary** (downloads `kashiro-dictionary.json` = `{"version":1,"words":[…]}`) and **Import dictionary** (a file input; it merges with `withWordAdded` for each word, so the case and NFC rules apply). It also gets the web note `settings.webStorage`: "Settings, your dictionary and saved reviews are kept in this browser. Clearing the browser's site data deletes them." Show both only when `capabilities.web`.
- Modify: `saveSettings` on the web **re-reads the stored dictionary and unions it** with the in-memory one before writing (Review focus 2).
- Modify: when `storageIsPersistent()` is false, show the notice `notice.noStorage` once: "This browser isn't keeping Kashiro's settings; they last until you close the tab."
- Test: `tests/platform-web/storage.test.ts` and `tests/dom/dictionaryExport.test.tsx`.

**Interfaces:**
- Consumes `Capabilities` from Task 1.
- Produces `storageIsPersistent(): boolean` and the `kashiro` IndexedDB schema `{ settings: { key: 'settings', value: Settings }, sessions: { key: string, value: { json: string, savedAt: number } } }`.

**Steps:**
- [ ] **Step 1. Failing tests,** written against an in-memory IndexedDB fake inside the test file. No dependency: a minimal fake of `open`/`transaction`/`objectStore` `get`/`put`/`delete`/`getAll` is enough, or test `storage.ts` through an injected backend. Cover:
  - the settings round trip;
  - `sessionFiles` `save`/`load`/`list`/`delete`, and `prune(30)` dropping a review saved 31 days ago;
  - a missing `indexedDB` → the memory fallback, plus `storageIsPersistent() === false`;
  - two "tabs": A saves dictionary `['vantix']`, then B (stale, with an empty dictionary) saves settings, and the stored dictionary still contains `vantix`;
  - Export then Import round-trips `['cutover','ARN','DBInstances']`, and Import of `["Cutover"]` stores `cutover` (F29 rule).
- [ ] **Step 2.** Run them and see them fail.
- [ ] **Step 3.** Implement it. Add the i18n strings in en/hi/bn.
- [ ] **Step 4.** Run the tests, tsc, then `npm test`. All pass.
- [ ] **Step 5.** Commit: `feat(web): settings, saved reviews and dictionary in browser storage`.

### Task 3: Web files (open, paste, drop, save, resume)

**Files:**
- Implement: `src/ui/platform-web/files.ts`.
  - `files.open()` uses `showOpenFilePicker` when present, otherwise a hidden `<input type=file accept=".docx,.txt,.md,.markdown">`.
  - It returns `OpenedFile { name, path: name, bytes }`. **On the web, `path` is the file name.** That's what makes the existing saved-review key (`sha256(bytes + path)`), the "latest review of the same path" fallback and `openRecent` work unchanged: `openRecent` calls `files.open(review.path)`, which on the web shows the picker, and the fingerprint decides between resume and "changed since".
- `files.save(path, bytes, { overwrite, original })` on the web:
  - **Not overwrite:** the suggested name is `basename(path)`, which is already the `.checked` sibling from `saveFlow`. If `picked.name.toLowerCase() === basename(original).toLowerCase()`, throw `SaveOverOriginalError`, as desktop does.
  - **Overwrite:** the suggested name is `basename(original)`, and the caller has shown `save.webNoBackup` before. Return `{ path: picked.name, backup: null }`.
  - **Picker:** `showSaveFilePicker({ suggestedName, types: [ext filter] })` and `createWritable()`.
  - **Download:** a `Blob` + `<a download=suggestedName>` + `URL.revokeObjectURL`, returning `{ path: suggestedName, backup: null }`. A cancelled picker returns `null`.
- `onFileDrop(onDrop)` on the web listens to `dragover`/`drop` on `window`.
  - Files are mapped to `DroppedFile { name, read }`.
  - **Text drops** call a new exported `onTextDrop(handler: (text: string) => void)`. The desktop version is a no-op that returns an unsubscribe. App wires it to `controller.openText`, behind `unlessUnsaved`, as Paste is.
- Paste: confirm the existing `navigator.clipboard.readText` path works unchanged on the web (no Tauri).
- Modify: `saveFlow.ts` shows the `save.webNoBackup` confirmation (`"No backup on the web: the original is replaced."`, en/hi/bn) when `capabilities.web && overwrite`.
- Test: `tests/platform-web/files.test.ts` and `tests/dom/webSaveParity.test.tsx`.

**Interfaces:**
- Consumes `Files`, `OpenedFile`, `SavedFile` and `SaveOverOriginalError` (`src/ui/state/saveFlow.ts`), and `DroppedFile`.
- Produces `onTextDrop(handler: (text: string) => void): Promise<() => void>` in both platforms.

**Steps:**
- [ ] **Step 1. Failing tests:**
  - With a fake `showSaveFilePicker` that records `suggestedName` and the written bytes: saving `report.docx` gives the suggested name `report.checked.docx`; with Overwrite, it's `report.docx` and the no-backup confirmation appears first. Picking `report.docx` without Overwrite throws `SaveOverOriginalError`.
  - With no `showSaveFilePicker`, the download path creates an anchor with `download="report.checked.docx"`.
  - **The parity test:** for the 11 tracked `.docx` fixtures plus one `.md` and one `.txt`, accept every rule suggestion through the controller with the desktop `files` fake and with the web `files`, then save clean and tracked. The written bytes are identical, and so are the suggested names (the folder part is ignored on desktop).
  - **Resume:** open `a.docx` (web `files`), make 2 decisions, close, then reopen via `openRecent` with the picker returning the same bytes. The decisions are restored. With different bytes, the "changed since" path runs.
  - **Text drop** opens the text as a new document. A 2.1 MB text drop shows the existing too-large notice, and a `.pdf` drop shows the existing unsupported notice, with the current document untouched.
- [ ] **Step 2.** Run them and see them fail.
- [ ] **Step 3.** Implement it.
- [ ] **Step 4.** Run the tests, tsc, `npm test`, then trust. All pass, with ticks 8/10 and zero-click 41.
- [ ] **Step 5.** Commit: `feat(web): open, drop, save and resume files in the browser`.

### Task 4: Web linter, dictionary data, speech, links, environment

**Files:**
- Implement in `src/ui/platform-web/`:
  - `linter.ts`: the same as desktop (`harper.js/binary`, the wasm loaded as an asset from `base`).
  - `dictionary.ts`: `fetch(new URL('dictionary/oewn.json.gz', import.meta.env.BASE_URL))`, with the file copied into the web build's `public` or assets.
  - `speech.ts`: the same as desktop, but `loadLocalVoices` and `onVoicesChanged` filter `voice.localService === true`. Check whether desktop already does; if it does, share the code.
  - `links.ts`: `openProjectPage(page)` = `window.open(PROJECT_URL + (page === 'issues' ? '/issues/new?template=bug.yml' : '/releases'), '_blank', 'noopener')`.
  - `environment.ts`: `environmentVersions()` returns `{ windows: null, webView2: null }` plus the browser name from `navigator.userAgentData?.brands` when present. Report a bug shows "Browser: …".
  - `helper.ts`: `modelFiles` and `startAppHelper` throw `'AI is available in the desktop app'`. `helperInstalled()` resolves `false`.
  - `windowPlacement.ts`: `rememberWindowPlacement()` returns `{ restored: Promise.resolve(), stop() {} }`.
- Test: `tests/platform-web/speech.test.ts` and `tests/platform-web/links.test.ts`, plus the bug-report redaction test run with the web environment.

**Steps:**
- [ ] **Step 1. Failing tests:**
  - With a fake `speechSynthesis` returning a voice with `localService: false` (named "Google हिन्दी") and one with `true`: only the local one is listed. With only network voices, `loadLocalVoices()` resolves `[]` and the read-aloud bar shows `speech.noOfflineVoice`.
  - `openProjectPage('releases')` calls `window.open` with `https://github.com/skmaiti2050/kashiro/releases`.
  - The web bug report contains "Browser:" and none of the planted path, name or text.
- [ ] **Step 2.** Run them and see them fail.
- [ ] **Step 3.** Implement it.
- [ ] **Step 4.** Run the tests, tsc, then `npm test`. All pass.
- [ ] **Step 5.** Commit: `feat(web): linter, word lookup, offline voices, links and environment in the browser`.

### Task 5: The web build (CSP, progress screen, PWA, update notice)

**Files:**
- Modify: `index.html`, adding a `<meta http-equiv="Content-Security-Policy">` **only in the web build**, through a Vite `transformIndexHtml` hook keyed on `KASHIRO_TARGET`. The value: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`. CodeMirror injects `<style>`, so `'unsafe-inline'` for styles is needed, as on desktop (F17).
- Create: `public-web/manifest.webmanifest` (name Kashiro, `start_url` and `scope` = base, `display: standalone`, theme `#1E2328`, icons from `src-tauri/icons` copied at build) and `src/web/serviceWorker.ts`, built to `sw.js`.
  - It precaches the build's emitted files: the build writes `precache.json` listing them, from the Vite manifest.
  - Cache-first for same-origin GETs.
  - The cache name includes the build id, so a new deploy installs a new cache.
- Create: `src/ui/web/useServiceWorker.ts`, which registers `sw.js` (web build only). When a new worker is waiting, it shows the toast `update.ready` ("Updated. Reload when you're ready") with a **Reload** button. **It never reloads by itself.**
- Modify: the loading screen in `index.html`/`main.tsx` shows a progress line ("Loading the proofreader… n MB") while Harper's wasm and the data download. It uses `fetch` streams for the wasm if the engine loader allows; otherwise an indeterminate bar.
- Modify: About and the status bar show "Preview" and the build date (`import.meta.env.VITE_BUILD_DATE`, set by `build-web.ts`).
- Test: `tests/web/csp.test.ts` (it reads `dist-web/index.html` after a build, or the transform function's output, and asserts the exact CSP), `tests/web/serviceWorker.test.ts` (with the cache API faked: install precaches the list, fetch serves from the cache, a new version's waiting worker triggers the toast, and nothing calls `location.reload` unless Reload is clicked).

**Steps:**
- [ ] **Step 1.** Write the failing tests.
- [ ] **Step 2.** Run them and see them fail.
- [ ] **Step 3.** Implement it.
- [ ] **Step 4.** Run the tests, tsc, `npm test`, then `npx tsx scripts/build-web.ts`. Then serve `dist-web` locally with `npx vite preview --outDir dist-web --base /kashiro/`. It's already a dev dependency, so nothing is new.
  - Load it in Chrome via the DevTools MCP: the sample paragraph checks, and the console has no CSP violations.
  - Turn on offline in DevTools, reload, and the app still loads and checks.
  - Report the total transferred size on the first load.
- [ ] **Step 5.** Commit: `feat(web): CSP, offline install, update notice and loading progress`.

### Task 6: Publishing to GitHub Pages (the controller shows the workflow to the owner first)

**Files:**
- Create: `.github/workflows/web.yml`, which **the owner reviews before it's committed**. Its contents:
  - **Triggers:** `release: { types: [published] }` and `workflow_dispatch`.
  - **Permissions:** `contents: read`, `pages: write`, `id-token: write`.
  - **The build job** runs on `ubuntu-latest`: `actions/checkout`, `actions/setup-node` (the node version from `package.json` engines, or 24), `npm ci`, `npm test` (the engine and DOM tests run headless), `npx tsx scripts/build-web.ts`, and `actions/upload-pages-artifact` with `dist-web`.
  - **The deploy job:** `actions/deploy-pages`.
  - Every action is pinned to a full commit SHA. No other secrets.
- Modify: `README.md`, adding **"Try it in your browser (preview)"** → `https://skmaiti2050.github.io/kashiro/`, above the download link.
- The controller (not the implementer) sets the repo homepage to the web URL with `gh repo edit` after the first successful deploy, and enables Pages (source: GitHub Actions) with `gh api`.

**Steps:**
- [ ] **Step 1.** Write the workflow to a scratch path. The controller shows it to the owner; on approval, it's copied into `.github/workflows/web.yml`.
- [ ] **Step 2.** Validate it locally: `npx tsx scripts/build-web.ts` succeeds from a clean `dist-web`.
- [ ] **Step 3.** Commit the workflow and README: `ci(web): deploy the web build to GitHub Pages on release or by hand`.
- [ ] **Step 4.** Controller, after the owner's OK: push, enable Pages, run the workflow by hand (`gh workflow run web.yml`), watch it, open the URL, and set the homepage.

### Task 7: Review before the preview goes public

- [ ] **Step 1.** Run the adversarial review (`.claude/skills/adversarial-review`) on the web paths: save parity, drop and paste limits, resume, the storage fallback, two tabs, speech voices, and the CSP. Report it in the skill's shape.
- [ ] **Step 2.** A browser pass on the built and served `dist-web`:
  - 760×480 up to 1920×1080;
  - light and dark;
  - 200% text;
  - hi/bn;
  - offline reload;
  - a Firefox-style no-`showSaveFilePicker` path (delete it in the page before loading).
- [ ] **Step 3.** A fix round for every Critical or Important finding, then re-run the verify steps of the affected tasks, then a full `npm test`, trust, upgrade:check and `npm run release` (the desktop build must still work).
