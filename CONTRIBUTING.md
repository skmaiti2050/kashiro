# Contributing to Kashiro

Thank you for helping. Kashiro's one promise is that it **never damages the user's text**. Every contribution is judged against that first.

## Good places to start

- **Report a wrong change.** If Kashiro changed text without a click, or a fix that starts ticked is wrong, open a "Wrong change" issue with the exact text. This is the most useful report there is.
- **Hindi and Bengali.** Proofreading rules for Indic text, and reviews of the Hindi and Bengali interface strings by native speakers.
- **Translations.** See [docs/TRANSLATING.md](docs/TRANSLATING.md) and [docs/i18n-style.md](docs/i18n-style.md).
- Issues labelled `good first issue`.

## Setting up

Windows 10 or 11, Node.js 24, and Rust (stable) with the Tauri 2 prerequisites.

```
npm ci
npm run dev
```

## Before you open a pull request

Read [CLAUDE.md](CLAUDE.md). It holds the coding standards for humans and AI coding tools alike: readable over clever, one responsibility per file, UTF-16 offsets everywhere, and a pure-TypeScript engine with no platform imports in `src/engine` or `src/formats`.

Then:

1. **Every bug fix comes with a test that failed before the fix.** Say in the pull request how you saw it fail.
2. `npx tsc --noEmit -p .` and `npm test` pass, with clean output.
3. If you touched `src/engine`, `src/formats` or the tiers, run `npm run trust` too. If `trust/out/decisions.md` changes, explain why in the pull request.
4. New interface text goes in all three catalogues (`en`, `hi`, `bn`). Mark Hindi or Bengali you are unsure of, and a native speaker will review it.
5. Commit messages follow `type(scope): summary` (feat, fix, test, docs, chore, build).
6. No machine-specific paths (drive letters, user folders) in committed files.

## Changes that need extra care

A change that makes Kashiro edit text **without a click**, or makes a fix **start ticked**, needs:

- a reason why it can never change a word, a letter's case or punctuation the user wrote;
- rows in the never-damage stress test (`tests/engine/neverDamage*.ts`), including the tricky inputs: hyphens and slashes, abbreviations, Indic text, invisible and direction characters, code and tables;
- for ticks, rows in the expected-ticks truth table.

When in doubt, make it a suggestion the user accepts. That is always allowed.

## Reproducing a report

```
npm run check-file -- input.txt output.txt
```

This runs the real engine on a file and writes what would change without a click, so you can turn an issue into a failing test.

## Licence

By contributing, you agree that your contribution is licensed under Apache-2.0, the project's licence.
