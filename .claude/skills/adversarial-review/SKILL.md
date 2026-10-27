---
name: adversarial-review
description: Use when reviewing a Kashiro change that touches the engine, formats, tiers, hygiene, zero-click edits, the simple-fixes card, batch cards, ticks or the change log, or before tagging a release, or when asked whether a change can damage or alter the user's text.
---

# Adversarial review

## Overview

Kashiro's rule #1 is that it never changes the user's text without permission. Code-reading reviews keep missing damage that only shows when real input goes through the real engine, card and "apply all" path. **An adversarial review attacks the running engine with trap inputs. Every finding is an input and the output Kashiro actually produced.**

## The review, in order

1. **Read** the brief, the implementer's report, the previous review report, and the diff for the range.
2. **Write trap cases** into a scratch `cases.json` (name → text; a name ending in `.md` is read as Markdown). Cover every surface the diff touches, using [traps.md](traps.md). Include the previous review's repros.
3. **Run them through the real engine**, from the repo root:
   - `npx tsx .claude/skills/adversarial-review/probe.mts cases.json` shows zero-click changes, every batch card with each member TICKED or unticked, and the text after accepting each card's default ticks, under 4 presets × default settings and every kind opted in.
   - `npm run check-file -- in.txt out.txt` writes what one document becomes without a click.
   - For a surface the probe doesn't reach (single-card accept and undo, carryDecisions, the change log), write a scratch harness that imports `src/engine`. Run it from the repo root so the path aliases resolve. A harness outside the repo must import by absolute `file:///` URL on Windows.
4. **Measure against the last baseline:** zero-click changes and default ticks on the trust corpus, and the decisions.md md5 (in `deps/reports/upgrade-report.md` after `npm run upgrade:check`). A count that moved is a finding until explained.
5. **Check the oracle.** Would the stress test and the truth table go red if this change were wrong? A judge that reuses the code it judges can't catch that code's bugs. Check which cards each judge actually looks at; a card no judge covers is a finding. Judges read the engine's decisions, so also check what the **rendered** card or preview ticks, including after a re-check changes its members while it is open (a jsdom harness around the real component).
6. **Write the report** in the shape below.

## Severity

| Level | Means |
|---|---|
| Critical | A zero-click change to a word, case or punctuation; lost or corrupted text |
| Important | A wrong or damaging fix that starts ticked on any card; a card editing outside its span; a gate or test that can't catch a regression; a performance-budget breach |
| Minor | Everything else |

This table decides severity. If an earlier review rated the same class differently, use this table and note the difference in the finding.

Accepted v1.0 risk (owner, 2026-10-27): an allowlisted doubling on the simple-fixes card starts ticked even when written on purpose ("with with" as a keyword, "and and" in lyrics). Report such cases as Minor unless the input is ordinary prose.

## Report

- **First line:** `Verdict: STOP (no Critical/Important)` or `Verdict: ITERATE`.
- **Each finding:** severity and title; the input with invisible characters escaped (`<U+200D>`); the exact output; the command that produced it; which presets and settings; whether it predates the range; a suggested fix.
- **Traps that held:** what you tried that Kashiro handled.
- **Not tested:** anything you only reasoned about. A finding found only by reading code is labelled "unreproduced".

## Rules

- The repo is read-only during a review. Scratch files go outside it.
- Run one heavy command at a time (the probe, sweeps, trust).
- Don't run `npm test`, `trust`, `release` or `cargo` unless the controller asks; they write into the repo.

## Common mistakes

| Mistake | Instead |
|---|---|
| Reviewing the diff only | Old code paths get new inputs; probe the whole surface |
| Probing Harper alone | Harper's flags pass through tiers, ticks and batching; probe the session |
| Checking one card | Every batch card has default ticks; the probe prints them all |
| "Found by reading" as the evidence | Reproduce it, or label it unreproduced |
| Rating a rare input Minor | Severity is by what happens, not how often |
