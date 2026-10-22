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
   advisories (`npm audit --omit=dev`, `cargo audit`) and the licence check. It fails if a licence is not on the
   allowlist.
2. **Upgrade one thing at a time.** One npm package (`npm install name@x.y.z`), one crate (`cargo update -p name
   --precise x.y.z` in `src-tauri`), or one data file (rebuild with its `npm run build:*` script, then update its
   entry in `deps/assets.json`).
3. **Check it:** `npm run upgrade:check -- --samples <sample-pack folder> [--dakshina <google-dakshina.csv>]`. It
   regenerates the snapshots in place, runs the type check, the tests (timing alone), the trust suite (alone),
   `cargo test` and a Tauri debug build, compares the CSP and capabilities with HEAD and checks the licences. It
   writes `deps/reports/upgrade-report.md` and exits 1 if anything failed. Without `--samples` the sample-pack
   flags are kept, not re-checked.
4. **Read the report.** New, removed or changed Harper flags by kind, reworded messages, changed suggestions,
   dictionary and word-list changes, licence changes, test and gate results. A reworded Harper message that the
   app matches (`tests/deps/harperMessages.test.ts`) fails the tests: update the matching code and its test.
5. **Commit or roll back.** Commit the upgrade with the regenerated `deps/snapshots/` and the report summary in
   the commit message, or roll back with `git restore` on the changed files.

## Licence allowlist

MIT, MIT-0, Apache-2.0 (also WITH LLVM-exception), BSD-2-Clause, BSD-3-Clause, 0BSD, ISC, Zlib, Unicode-3.0,
Unicode-DFS-2016, CC0-1.0, CC-BY-3.0, CC-BY-4.0 and OFL-1.1 everywhere; CC-BY-SA for data files only; MPL-2.0
for crates only. Anything non-commercial or unknown fails. SPDX expressions are read properly: one allowed
choice of an OR is enough, every part of an AND must be allowed.

Decisions:

- **BSD-3-Clause** is listed by name for `react-intl` and `intl-messageformat` (owner accepted, 2026-10-22).
- **OFL-1.1** is allowed for all packages, for the bundled fonts (owner approved).
- **MPL-2.0** is not allowed for npm. `axe-core` (MPL-2.0) is a dev-only test tool, and the npm check reads
  production packages only, as `license-checker --production` would.
- The crate list lives twice, in `scripts/deps/licences.ts` and `src-tauri/deny.toml`; a test keeps them equal.

## Permissions

The CSP and the capabilities must never widen in an upgrade. `upgrade:check` compares `src-tauri/tauri.conf.json`
and `src-tauri/capabilities/*.json` with HEAD: an added CSP source, a dropped CSP directive, a new permission or
capability, or any change to another security setting fails. A deliberate change (Task 12 adds the
`llama-server` sidecar) is its own reviewed commit, never part of an upgrade.
