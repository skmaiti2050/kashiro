# Upgrading a dependency

Nothing changes until we choose to upgrade, and every upgrade produces a report of what changed.

## What is pinned

- **npm:** exact versions in `package.json` (`.npmrc` has `save-exact=true`), `package-lock.json` committed.
- **Rust:** `src-tauri/Cargo.lock` committed.
- **Data files and models:** `deps/assets.json`, one entry each with version, source URL, licence, the source
  sha256 its build script verifies, and the sha256 of the committed file. The local model and `llama-server` are
  `planned` until Task 12 and have no hashes yet.
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
for crates only. Anything non-commercial or unknown fails. SPDX expressions are read properly: one allowed
choice of an OR is enough, every part of an AND must be allowed, and a malformed expression ("MIT OR AND")
fails.

Decisions:

- **BSD-3-Clause** is listed by name for `react-intl` and `intl-messageformat` (owner accepted, 2026-10-22).
- **OFL-1.1** is allowed for all packages, for the bundled fonts (owner approved).
- **MPL-2.0** is not allowed for npm. `axe-core` (MPL-2.0) is a dev-only test tool, and the npm check reads
  production packages only, as `license-checker --production` would. Packages marked `devOptional` in the
  lockfile are optional production dependencies too, so they are checked.
- The crate list lives twice, in `scripts/deps/licences.ts` and `src-tauri/deny.toml`; a test keeps them equal.

## Permissions

The CSP and the capabilities must never widen in an upgrade. `upgrade:check` compares `src-tauri/tauri.conf.json`
and every capability file under `src-tauri/capabilities/` (subfolders included, as Tauri globs `capabilities/**/*`;
`schemas/` skipped; `.json`, `.toml`, and one capability, a list or `{ "capabilities": [...] }` per file) with the
committed baseline `deps/snapshots/permissions.json`. A capability identifier defined twice, or a `.json5` file,
fails.
These all fail: an added CSP source, a dropped CSP directive, a new permission, window, remote URL or capability,
a new platform (or a dropped platform list, which means every platform), local access turned on, or any change to
another security setting. A TOML capability that uses more than strings and string arrays fails to read: write it
as JSON.

The app's own commands (`overwrite_with_backup` and the saved-review `session_*` commands, registered in
`src-tauri/src/lib.rs`) need no capability entry: Tauri lets the app's windows call the app's own commands. So
a new or changed command never shows in this diff; review `invoke_handler` in `lib.rs` and the command's own
checks (the session commands accept only hex or uuid keys and touch only `<app data>/sessions/`).

upgrade:check never rewrites the baseline, so a widening fails even after it is committed to tauri.conf.json. A
deliberate change (Task 12 adds the `llama-server` sidecar) is its own reviewed commit, never part of an
upgrade: make the change, run `npm run deps:accept-permissions`, and commit the baseline's diff with it so the
reviewer sees exactly what was widened.
