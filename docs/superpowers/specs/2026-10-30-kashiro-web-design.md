# Kashiro on the web: design

Date: 2026-10-30. Status: draft for the owner's approval.

## Intent

Make Kashiro usable from a link, with no installer and no SmartScreen warning. It serves two people:

- **New users** try it before they download. It's the "pull" for promotion (Peerlist, Product Hunt and others), so the link should land straight on a working proofreader.
- **Day-to-day users** who can't or won't install software (a work PC, a borrowed machine) use it as their proofreader.

It is the **full app minus the AI features**, not a cut-down demo.

## Goals

- The same engine, cards, simple-fixes card, ticks, change log, Undo, Find, palette, dictionary, themes, read-aloud, saved reviews, and the English/Hindi/Bengali interface as the desktop app.
- **The same promise:** text never leaves the device. Checking runs in the browser, and nothing is uploaded.
- **Works offline after the first visit,** and can be installed as a web app (PWA).
- **One codebase:** the engine and UI are shared, and only the platform layer (`src/ui/platform`) differs. The never-damage and trust checks guard both builds.
- **Cheap to move from GitHub Pages to Cloudflare Pages later:** the build produces a plain static folder, and nothing depends on Pages-specific behaviour.

## Non-goals

- AI rewrites (llama.cpp) on the web.
- Accounts, sync between desktop and web, or any server.
- Remembering window size and position, a "Check for updates" button, or Explorer integration.
- Mobile-first layout. It must work on a tablet-sized window; touch optimisation is issue #33.

## Anti-goals (a failure even if it works)

- Any request that sends document text, file names or the dictionary off the device. That includes **online speech voices**: Chrome's "Google" voices send text to Google.
- Third-party scripts, fonts, analytics or cookies.
- A web build that silently diverges from desktop in what it changes. Every web path that writes text must go through the same engine and the same checks.

## Owner's decisions (2026-10-30)

- A **full working app without AI.** Trying it first is the pull strategy.
- **Hosting: GitHub Pages first** (`https://skmaiti2050.github.io/kashiro/`), with Cloudflare Pages kept as an option for later.
- **Saving works as on desktop.** Save suggests the sibling copy name (`report.checked.docx`, as `saveFlow`'s `siblingPath(name, '.checked')`) and never replaces the original by default.
  - **With the existing "Overwrite" setting on,** Save suggests the **original name** instead, and shows "No backup on the web: the original is replaced". The user confirms the system "Replace?" prompt.
  - **Chrome and Edge** use `showSaveFilePicker` with `suggestedName`. **Firefox and Safari** download with that name; the browser may add "(1)", which is acceptable.
  - Clean and tracked-changes .docx, .md and .txt are byte-identical to desktop. The test compares bytes and the suggested name.
  - There's no `.bak` on the web. That's acceptable only because the user explicitly chose Overwrite and confirmed the OS prompt.
- **Resuming saved reviews of files:** a review stores only the **file name and the content fingerprint**, never the text. Its key is `sha256(bytes + name)` instead of the path.
  - Opening a recent file review asks the user to **pick the file again**. Kashiro checks the fingerprint: if it matches, the review resumes; if the file has changed, it uses today's "the file changed since" path, matched by name.
  - This works in every browser and keeps "a saved review never holds the file".
  - Reviews of pasted text resume as on desktop.
- **Going live:** the **first deploy as soon as W1–W4 pass**, labelled "preview" in the UI and the README. After that, it **updates only when a GitHub release is published, or the workflow is run by hand** (`release: published` + `workflow_dispatch`), **not on every push.**

## Controller's calls (owner may change)

| Area | Web behaviour |
|---|---|
| Open | File picker (`<input type=file>`, or `showOpenFilePicker` where available), drag and drop of files, and **drag and drop of text** (which works on the web, unlike desktop) |
| Paste | `navigator.clipboard.readText()` after the user's click. If it's refused, open an empty document with "Press Ctrl+V", as on desktop |
| Settings, dictionary, saved reviews | IndexedDB, in an equivalent of the desktop store's shape. Settings › Saving gets a note that clearing the browser's site data deletes them, plus **Export / Import dictionary** as a JSON file |
| Read-aloud | Web Speech API, **on-device voices only** (`voice.localService === true`). If there's none, show "No offline voice is installed" |
| Look up (WordNet), word frequency, romanised n-grams | The same bundled data, loaded on demand and cached |
| Report a bug | The same redacted report. "Open GitHub issues" opens in a new tab |
| About | The version and build date. "AI rewrites are available in the desktop app" with a link to Releases. Licences as on desktop |
| Hidden on the web | AI menus and settings, window memory, Check for updates, model-file settings |
| First load | About 10–15 MB (Harper WASM, WordNet, frequency data). Show a progress screen, and load the large data lazily where the engine allows |
| Offline / PWA | A service worker caches the app shell and data after the first load. It updates when a new version is deployed, with a small "Updated, reload" notice. Never reload mid-review |
| Security | A strict CSP via `<meta http-equiv>` (Pages can't set headers): `default-src 'self'`, `connect-src 'self'`, no inline script, WASM allowed (`'wasm-unsafe-eval'`). Same-origin only |
| Base path | Built with a `base` of `/kashiro/` for Pages, configurable by an environment variable so Cloudflare or a custom domain can use `/` |

## Architecture

- **One platform interface, two implementations.** Today `src/ui/platform/*` calls Tauri.
  - Introduce a single platform module boundary, chosen at build time with a Vite alias or an env flag: `platform/tauri/*` (today's code, moved) and `platform/web/*` (new).
  - The engine (`src/engine`, `src/formats`) is untouched; it's already pure TypeScript.
- **Feature flags come from the platform,** not scattered `if (web)` checks. The platform reports `capabilities` (for example `ai: false`, `windowMemory: false`, `updates: false`, `textDrop: true`, `saveInPlace: 'picker' | 'download'`), and the UI hides or shows items from those.
- **Build:**
  - `npm run build:web` produces `dist-web/`, a static site.
  - The existing `npm run build` / `release` (desktop) stays as it is.
- **Deploy:** a GitHub Actions workflow builds the web app on a **published release** or a **manual run** (`workflow_dispatch`) and deploys it to Pages. The first manual run is the preview launch. **The owner reviews the workflow file before it's added.** It must not run release builds or need secrets beyond the default Pages token.

## Testing

- **All existing tests stay green.** New platform tests run the web implementations under jsdom with fakes for IndexedDB (`fake-indexeddb` only if no dependency is needed; otherwise an in-memory adapter), the File System Access API and speech.
- **The never-damage checks:** the trust suite and the truth table already run on the engine. Add a test that the web save path writes **exactly** what the desktop save path writes for the same review: clean, tracked, .md and .txt.
- **A browser pass** of the built `dist-web` served locally: sizes, themes, Hindi/Bengali, offline after a reload with the network blocked, and the CSP blocking a test request.
- **The adversarial review** (`.claude/skills/adversarial-review`) on the web paths before the first public deploy.

## Rounds (estimate, about 1 day of agent time)

1. **W1, platform split and web adapters:** open, paste, drop, save (picker or download), storage, speech, links, and capabilities.
2. **W2, web build:** base path, CSP, the progress screen, the service worker and PWA manifest, and the update notice.
3. **W3, publishing:** the Pages workflow (owner review), README "Try it in your browser", and the repo homepage switched to the web URL.
4. **W4, review:** the adversarial review on web paths, a browser pass, and fixes.

## Left to the builder

- How exactly to swap the platform layer (Vite alias vs. env flag), as long as the desktop build is unchanged and tree-shakes the web code (and the other way round).
- The IndexedDB schema details and migrations.
- Service worker tooling, preferably hand-written or Vite-native with **no new dependency**. If a dependency is truly needed, give the reason in the report.
