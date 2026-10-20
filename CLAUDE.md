# writing-check: coding standards

Read before writing or reviewing code here. The design is `docs/superpowers/specs/`, the current plan is `docs/superpowers/plans/`.

## What matters most

1. **Never damage the user's text or file.** Fact-locked spans, the LLM and "can't place it safely" cases never auto-apply. When unsure, skip the edit and report it; never write it half-way.
2. **Readable over clever.** A mid-level TypeScript developer should follow any function on first read.
3. **Simple over general.** Build what the current task needs (YAGNI). No options, flags or abstractions without a second caller.
4. **Efficient where it counts.** The rules pass must stay under 300 ms for 1,500 words. Measure before optimising; elsewhere prefer the plain version.

## Structure

- `src/engine` and `src/formats` are pure TypeScript that runs in Node and the browser: no `fs`, `Buffer`, DOM or Tauri imports there. Platform code lives in `src/ui/platform` and `cli/`.
- One responsibility per file. If a file passes ~300 lines or needs a section comment to navigate, say so in the task report instead of silently splitting it.
- Prefer deep modules: a small interface hiding real work (see `.claude/skills/codebase-design`). Don't add a seam until two implementations need it.
- Pass dependencies in (linter, clock, file access); return results instead of mutating arguments.

## Code

- Names say what a thing is or does (`findLockedSpans`, not `processSpans`). No abbreviations except well-known ones (`xml`, `id`, `url`).
- Short functions with early returns; avoid nesting deeper than three levels.
- Comments explain *why*, not *what*: one line on a non-obvious rule, a spec reference (`// spec §5`), or a gotcha (`// Harper's setDialect drops imported words`). No commented-out code.
- Regexes: one per purpose, named constant, a one-line comment with an example match. Avoid patterns that can backtrack badly on long input.
- Errors: throw with a message a user could act on; never swallow an error silently. Expected outcomes (unplaceable edits, unknown extensions) are return values, not exceptions.
- Offsets are UTF-16 indices into JavaScript strings, end-exclusive, everywhere.
- Free Harper WASM objects after copying their fields.
- No new dependency without a reason in the task report (size, licence, maintenance).

## Tests

- Test behaviour through the module's interface, with the exact values from the spec or plan.
- Every bug fix gets a test that failed before the fix.
- Test output must be clean: no warnings, no stray logs.
- `npm test` must pass before every commit; `npm run trust` before every milestone.

## Workflow

- Run `/simplify` on the changes at the end of each milestone.
- Commit messages: `type(scope): summary` (feat, fix, test, docs, chore, build).
- No machine-specific paths (drive letters, user folders) in committed files.
- No humanizer / AI-detection / watermark / plagiarism wording anywhere.
