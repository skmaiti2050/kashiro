# Upgrading a dependency

Nothing changes until we choose to upgrade, and every upgrade produces a report of what changed.

## What is pinned

- **npm:** exact versions in `package.json` (`.npmrc` has `save-exact=true`), `package-lock.json` committed.
- **Rust:** `src-tauri/Cargo.lock` committed.
- **Data files and models:** `deps/assets.json`, one entry each with version, source URL, licence, the source
  sha256 its build script verifies, and the sha256 of the committed file. The default model and `llama-server`
  (b11727) are pinned but not committed: the user picks the model file, and `npm run fetch:llama` downloads the
  two official release zips from the pinned URLs, checks each zip's sha256 and then every file's, and copies only
  the pinned files into the gitignored `src-tauri/binaries/`: the server and its libraries from the CPU zip into
  `binaries/llama/`, and only `ggml-vulkan.dll` from the Vulkan zip into `binaries/vulkan/` (the rest of that zip
  is the same). Files that are not pinned are removed from those two folders. Run it before `cargo test` or a
  Tauri build; CI needs this step too. Offline, pass local copies instead:
  `npm run fetch:llama -- --vc-runtime <folder> <CPU build zip or folder> <Vulkan build zip or folder>`.
  `npm run check:llama` (run by every Tauri build, by `npm run portable:zip` and by upgrade:check) fails when the
  folders hold anything but exactly the pinned files.
- **The Visual C++ runtime** (`vc-runtime` in assets.json): `msvcp140.dll`, `vcruntime140.dll` and
  `vcruntime140_1.dll` from Microsoft's redistributable, copied into `binaries/llama/` beside `llama-server.exe`
  so the helper runs without a runtime install (it needs admin rights). `--vc-runtime <folder>` is required: a
  folder holding the three DLLs, extracted from the pinned `vc_redist.x64.exe` (Microsoft's WiX Burn bundle). It
  is never run; take it apart with 7-Zip:
  1. Download `https://aka.ms/vc14/vc_redist.x64.exe` into a new folder and check its sha256 against
     `archiveSha256`, and that `Get-AuthenticodeSignature` says Valid, signed by Microsoft Corporation.
  2. 7-Zip lists only the bundle's UI container. The payload is a cabinet appended to the exe: copy the bytes
     from its `MSCF` header, as long as the header's size field (offset 8) says, into a `.cab` file and open
     that with 7-Zip. It holds `a0`–`a5`; the cabinet holding `*_amd64` files has the x64 DLLs
     (`msvcp140.dll_amd64` and so on).
  3. Extract the three `_amd64` files, drop the `_amd64` suffix, and check each DLL's file version and
     Authenticode signature (Microsoft).
  The version must be at least the newest MSVC toolset any bundled llama.cpp file was linked with
  (`dumpbin /headers`, "linker version": 14.51 for b11727's `ggml-vulkan.dll`). On a llama.cpp upgrade, check that
  again and that every `MSVCP140`/`VCRUNTIME140*` import of the new files is exported by the runtime.
- **Third-party notices:** `resources/notices/THIRD-PARTY-NOTICES.txt` holds the licence texts of the npm
  production packages and of the crates compiled into the exe. After any upgrade, run `npm run build:notices`
  (offline: installed packages and `cargo metadata --offline`) and commit the result with the upgrade;
  `tests/scripts/build-notices.test.ts` and upgrade:check fail when the file differs from what the installed
  packages give. A new data file or bundled program needs its own `ATTRIBUTION.md` under `resources/`, a line in
  `src/ui/notices.ts` and a `notices/` entry in `bundle.resources`.
- **Release configs:** `src-tauri/tauri.conf.json` builds the full app; `src-tauri/tauri.noai.conf.json` is
  merged over it (`tauri build --config`, a JSON Merge Patch) for the version without the AI helper: it removes
  the llama resources and adds `src-tauri/nsis/noai-hooks.nsh`, which removes `llama\` when it is installed
  over the full app. `npm run release` builds both installers and both zips (`scripts/release.ts`).
- **Behaviour:** `deps/snapshots/` holds what the dependencies do today: every Harper flag on the 22 reference
  documents, the sample pack and short probe texts (`harper.json`), dictionary counts and 50 lookups, word-list
  counts and hashes (`data.json`), every production licence (`licences.json`) and the decisions-table hash
  (`reference-values.json`). Only short excerpts are stored; see `deps/snapshots/ATTRIBUTION.md`.
- **Permissions:** `deps/snapshots/permissions.json` is the accepted CSP and capabilities. Only
  `npm run deps:accept-permissions` rewrites it (see Permissions below).

## Tools

Install once, at these versions:

```
cargo install --locked cargo-audit@0.22.2
cargo install --locked cargo-deny@0.20.2
```

`deps:status` skips a missing tool with a warning. There is no npm licence-checker dependency: our own check
reads the installed packages (`scripts/deps/licences.ts`).

## The playbook

1. **See what could change:** `npm run deps:status` (uses the network; the app never does). It writes
   `deps/reports/deps-status.md` (gitignored): outdated npm packages and crates, newer data releases, security
   advisories and the licence check. npm advisories come in two sections: production packages
   (`npm audit --omit=dev`), where any advisory fails the run, and dev tools (the rest of a full `npm audit`),
   whose high and critical advisories are "action needed" warnings because they run on this machine during
   tests. Rust advisories come from `cargo audit`. It also fails if a licence is not on the allowlist. A tool that gave no usable answer (no output, an error, text instead of JSON) is reported as
   "could not check" with a warning, never as clean. If cargo-deny is missing the headline says "Licences: not
   fully checked", and a production npm package that is not installed fails the licence check (run `npm ci`).
2. **Upgrade one thing at a time.** One npm package (`npm install name@x.y.z`), one crate (`cargo update -p name
   --precise x.y.z` in `src-tauri`), or one data file (rebuild with its `npm run build:*` script, then update its
   entry in `deps/assets.json`).
3. **Check it:** `npm run upgrade:check -- --expect <the package you upgraded> --samples <sample-pack folder>
   [--dakshina <google-dakshina.csv>]`. Always pass `--expect`, once per package that may legitimately change
   (`--expect vitest --expect @vitest/mocker`). The report starts with the lockfile graph changes against HEAD,
   for `src-tauri/Cargo.lock` and `package-lock.json`: packages added, removed or at another version, and
   dependency edges re-pointed in other packages ("cssparser-macros 0.7.1: syn 3.0.9 -> 2.0.119"). A new package,
   a removed one, or a new version of one outside the `--expect` packages fails: `cargo update -p` and
   `npm install` can move other packages too. An edge re-pointed between versions that were already in the
   lock is only a warning ("re-pointed between existing versions"): when a range such as windows-sys
   `>=0.60, <0.62` allows two locked versions, cargo's pick changes with each update, and nothing new is built. It
   then regenerates the snapshots in place, runs the type check, the tests (timing alone), the trust suite (alone),
   `cargo test` and a Tauri debug build, compares the CSP and capabilities with `deps/snapshots/permissions.json`
   and checks the licences. It writes `deps/reports/upgrade-report.md` and exits 1 if anything failed, including a
   missing decisions table. Without `--samples` the sample-pack flags are kept, not re-checked.
4. **Read the report.** New, removed or changed Harper flags by kind, reworded messages, changed suggestions,
   dictionary and word-list changes, licence changes, test and gate results. A reworded Harper message that the
   app matches (`tests/deps/harperMessages.test.ts`) fails the tests: update the matching code and its test.
5. **Commit or roll back.** Commit the upgrade with the regenerated `deps/snapshots/` and the report summary in
   the commit message, or roll back with `git restore` on the changed files.

## Licence allowlist

MIT, MIT-0, Apache-2.0 (also WITH LLVM-exception), BSD-2-Clause, BSD-3-Clause, 0BSD, ISC, Zlib, Unicode-3.0,
Unicode-DFS-2016, CC0-1.0, CC-BY-3.0, CC-BY-4.0 and OFL-1.1 everywhere; CC-BY-SA for data files only; MPL-2.0
for crates only; the Microsoft Visual C++ Redistributable (`LicenseRef-Microsoft-VC-Redistributable`) for bundled
binaries only (the assets.json entries with `files`). Anything non-commercial or unknown fails. SPDX expressions are read properly: one allowed
choice of an OR is enough, every part of an AND must be allowed, and a malformed expression ("MIT OR AND")
fails.

Decisions:

- **BSD-3-Clause** is listed by name for `react-intl` and `intl-messageformat` (owner accepted, 2026-10-22).
- **OFL-1.1** is allowed for all packages, for the bundled fonts (owner approved).
- **MPL-2.0** is not allowed for npm. `axe-core` (MPL-2.0) is a dev-only test tool, and the npm check reads
  production packages only, as `license-checker --production` would. Packages marked `devOptional` in the
  lockfile are optional production dependencies too, so they are checked.
- **The Visual C++ Redistributable** is allowed for bundled binaries only (owner decision, Task 14 fix round 2):
  `llama-server` needs its three runtime DLLs beside it, and installing the runtime needs admin rights. They
  are Microsoft's Distributable Code (https://aka.ms/VCRedistLicense), not open source; the llama notice says so.
- The crate list lives twice, in `scripts/deps/licences.ts` and `src-tauri/deny.toml`; a test keeps them equal.

## Permissions

The CSP and the capabilities must never widen in an upgrade. `upgrade:check` compares `src-tauri/tauri.conf.json`
and every capability file under `src-tauri/capabilities/` (subfolders included, as Tauri globs `capabilities/**/*`;
`schemas/` skipped; `.json`, `.toml`, and one capability, a list or `{ "capabilities": [...] }` per file) with the
committed baseline `deps/snapshots/permissions.json`. A capability identifier defined twice, or a `.json5` file,
fails. The release config without AI (`tauri.noai.conf.json` merged over `tauri.conf.json`) counts too: whatever
it changes is recorded under `noai` keys (its `bundle.resources`, a CSP of its own), and an NSIS hooks file of
either config by its sha256, since it runs at install time.
These all fail: an added CSP source, a dropped CSP directive, a new permission, window, remote URL or capability,
a new platform (or a dropped platform list, which means every platform), local access turned on, or any change to
another security setting, including `bundle.externalBin` and `bundle.resources` (where the `llama-server` the app
runs and its Vulkan backend are bundled, beside the dictionary and the notice files). A TOML capability that uses more than strings and string arrays fails to read: write it
as JSON.

The app's own commands (`overwrite_with_backup` and the saved-review `session_*` commands) are locked down by
an app manifest in `src-tauri/build.rs`: Tauri generates an `allow-<command>` permission for each (underscores
become hyphens, e.g. `allow-session-save`), and a webview may call only the commands a capability grants. To add
a command:

1. Register it in `generate_handler!` in `src-tauri/src/lib.rs`.
2. Add its name to the `AppManifest::new().commands(&[...])` list in `src-tauri/build.rs`.
3. Grant `allow-<command>` in `src-tauri/capabilities/default.json`.
4. Run `npm run deps:accept-permissions` and commit the baseline's diff with the command, so the reviewer sees
   the new grant.

`tests/deps/appCommands.test.ts` fails if the handler list and the manifest list differ, if the capability
grants a different set, or if the frontend invokes a command that is not registered. Review the command's own
checks too (the session commands accept only hex or uuid keys and touch only `<app data>/sessions/`).

upgrade:check never rewrites the baseline, so a widening fails even after it is committed to tauri.conf.json. A
deliberate change is its own reviewed commit, never part of an upgrade: make the change, run
`npm run deps:accept-permissions`, and commit the baseline's diff with it so the reviewer sees exactly what was
widened. Task 12 did this for the writing helper: `connect-src http://127.0.0.1:*` (the local llama-server on a
port chosen at each start) and the `llm_start`, `llm_stop` and `sha256_file` commands; Task 14 added
`llm_installed` (whether the helper's files are there) and moved the bundled files to `llama/` and
`llama/vulkan/`. The webview has no shell or process permission: Rust starts only the bundled `llama-server`,
on the processor or with its Vulkan backend, with a fixed argument list.
