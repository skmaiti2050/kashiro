## What and why

## How I tested it

- [ ] A test that failed before this change (for a bug fix): how I saw it fail:
- [ ] `npx tsc --noEmit -p .` and `npm test` pass
- [ ] `npm run trust` passes (needed if `src/engine`, `src/formats` or the tiers changed)
- [ ] `trust/out/decisions.md` is unchanged, or I explain the change below
- [ ] New interface text is in `en`, `hi` and `bn`

## Never-damage

Does this make Kashiro change text without a click, or make a fix start ticked? If yes, explain why it can never change a word, case or punctuation, and point to the stress-test or truth-table rows.
