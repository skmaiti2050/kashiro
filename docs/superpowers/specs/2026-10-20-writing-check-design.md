# writing-check: design

*Working title. Date: 2026-10-20. Owner: Sujit Kumar Maiti.*

## 1. Intent

A free, open-source, **offline** desktop app that checks a piece of writing for grammar mistakes and for
sentences that don't read naturally, fixes the safe things automatically, and asks the writer only about
the changes that need human judgment. It works on documents in place (Word, OpenDocument), keeps their
formatting, and never sends text off the device.

**Why it should exist.** Grammar checkers today are either cloud services (Grammarly, LanguageTool
Premium, ProWritingAid: private text leaves the machine, often banned on work laptops) or local rule
engines with no document support and no "reads naturally" help (Harper, Vale). AI "cleanup" tools
(Wispr Flow's auto-edit, QuillBot, "humanizers") rewrite silently and change meaning. An audit of one
such tool (Turnitout; its findings are kept outside this repo) showed added hedges on statistical
claims, broken grammar and false marketing claims. The gap: **fix a whole document offline, keep its
formatting and its meaning, and only review what actually needs a human.**

**One-line positioning:** *Your words, your meaning, fewer mistakes. Nothing leaves your device.*

## 2. Users and personas

Anyone who writes for an audience. Check every default against these five:

| Persona | Writes | Cares about | Must not happen |
|---|---|---|---|
| **Blogger / news writer** | 800-2,000-word posts in Google Docs, daily | Speed, readability, natural tone | Being nagged about house-style choices |
| **Student** | Project reports, assignments in .docx | Grammar, academic tone, not losing citations | Anything that looks like "AI-washing" their work |
| **Researcher** | Papers, grant text in Word/LibreOffice | Numbers, citations and terminology untouched | A result's meaning shifted ("p < 0.001, broadly speaking") |
| **Scriptwriter / content creator** | Daily video scripts, casual voice | Speed; fragments and slang are intentional | Being "corrected" into formal prose |
| **Corporate writer on a locked-down laptop** | Reports, emails, proposals | Privacy, works without admin/IT approval | Needing installs, add-ins or internet |

## 3. Goals (v1)

1. **Input**: open a file (.docx, .odt, .txt, .md), paste, or type in the app's own editor.
   Google Docs via **download as .docx → fix → re-upload** (with in-app instructions and a drop zone).
2. **Two checking passes**
   - **Rules pass (always on, instant):** Harper (via its official `harper.js` WebAssembly package) for
     spelling, grammar, punctuation, doubled words, capitalisation, spacing; plus hygiene: remove
     zero-width/invisible characters.
   - **"Reads naturally" pass (optional download):** a small local LLM via llama.cpp suggests rewrites
     for awkward sentences. Offered at first run as an optional 1-3 GB download; the app is fully useful
     without it.
3. **Review without fatigue** (the core design idea; see §5).
4. **Write back in place**: save the corrected document **with formatting intact** (styles, headings,
   bold/italic, tables, lists, comments, headers/footers, tracked-changes state, images untouched).
   Default saves a new copy (`name.checked.docx`); overwrite-with-backup is an option.
   **Edits are written as native tracked changes by default** (`w:ins`/`w:del` attributed to author
   "writing-check" in .docx; `text:tracked-changes` in .odt), so Word and LibreOffice show them in their
   own Review tools and Google Docs imports them as Suggestions. No plugin or control of Word is needed:
   it is markup in the file. Existing tracked changes in the document are preserved. "Save clean"
   (changes applied, no markup) is an option.
5. **Writing goal presets**: Academic / Blog & news / Script / Business. A preset changes **which
   suggestions are shown and how they're tiered**, never the writer's voice (e.g. Academic flags
   contractions; Script allows fragments and casual register).
6. **Fact lock**: numbers, dates, names, quotes, citations, URLs, code and LaTeX math are protected.
   No automatic change may alter them; any suggestion touching them is always shown for review.
7. **Change log with undo** for every applied change, automatic or manual, exportable as a report.
8. **Trust suite**: the Turnitout audit kit becomes this app's public test suite (§9).
9. **Word lookup (offline dictionary)** *(added 2026-10-20 at the owner's request)*: a reference to help
   the writer decide, not a writing aid.
   - **While reviewing:** every review item has a "Look up" toggle that shows the definitions of the
     original word and of the suggested word side by side (the affect/effect, its/it's case).
   - **Any selected word:** select a word in the document view and press `Ctrl+D` (or right-click →
     Look up) to open the same panel.
   - **Shows:** part of speech, 1-3 short definitions, one example, a few synonyms. If the word is in the
     personal dictionary or the built-in Indian-English list, the panel says so, even without a definition.
   - **Read-only in v1:** synonyms are not clickable replacements; the lookup informs the decision and never
     edits the text.
   - **Data** *(Claude's call)*: Open English WordNet (CC BY 4.0; attribution in About), converted at build
     time from a pinned release into a compact bundled file (target ≤15 MB compressed), loaded on first use.
     No network. English only; Hindi/Bengali lookup arrives with the Indian-languages stage.

## 4. Non-goals and anti-goals

**Non-goals for v1 (later, maybe):** dictation (planned v2 module, reusing Handy's MIT transcription
code); Google Docs add-on (v2+); Indian languages (after English is solid); real-time checking inside
other apps/websites; mobile.

**Anti-goals (would be a failure even if it "works"):**
- **No humanizer / detection evasion.** No "make it undetectable" mode, no claims about AI detectors,
  watermarks or plagiarism checkers. The app may never be marketed as such.
- **No silent meaning changes.** The LLM may never auto-apply; facts are locked.
- **No network calls by default.** The only network use is the user-initiated model download (and
  update checks if the user opts in). No telemetry.
- **No admin rights, no system hooks, no accessibility/keyboard permissions, no Office add-ins.**
- **No 80-click review sessions** (see §5).

## 5. Review without fatigue

Suggestions are sorted into tiers by risk, not shown as one long list.

| Tier | What | Default behaviour |
|---|---|---|
| **Safe (auto)** | Spelling, doubled words, punctuation, capitalisation, spacing, invisible characters, from the deterministic rules pass, and not touching fact-locked spans | Applied automatically; listed in the change log |
| **Batched** | The same correction repeated ("it's → its", 9 places) | One decision: apply all / see each |
| **Review** | Rewording, sentence split/merge, every LLM suggestion, anything touching fact-locked spans, anything the preset marks as style | Shown one at a time as a before/after diff |

- **What may be auto-applied** *(builder's-check call, made by Claude)*: a rules-pass fix is Safe only if
  it has a single suggestion and touches no fact-locked span. **Unknown capitalised words, words inside
  names, acronyms, jargon and non-English words (e.g. Indian names) are never auto-corrected**; they go
  to Review with an "add to dictionary" option. Grammar fixes with one deterministic answer (a/an,
  doubled words) are Safe; other grammar (agreement, tense, word choice) is Review.
- **English variant** *(Claude's call)*: detect the dominant spelling variant from the document
  (American / British / others Harper supports), with a per-document override and an app default taken
  from the OS locale. Never auto-convert between variants; a mixed document is flagged for review once,
  as a batch.
- **Names card** *(owner's decision, 2026-10-20)*: all unknown capitalised words (people, places, brands)
  are reviewed together on one card with checkboxes ("Add all to my dictionary", untick any real typos).
  It counts as one decision. A repeated flag of the same word is always one batched decision.
- **Review depth slider** *(owner's decision, 2026-10-20)*: Light / **Standard** (default) / Thorough /
  Everything, in Settings (saved per preset) and adjustable from the review panel. It sets how many decisions
  are shown up front per 1,500 words (about 5 / 10 / 25 / all, never fewer than 3 / 10 / 25 for short texts) and how many LLM rewrites run automatically
  (1 / 3 / 6 / on request only). It never changes what is auto-applied, the fact lock, or the rule that LLM
  suggestions need approval. The trust suite measures the Standard level.
- The review list shows the **5-10 highest-value suggestions first**; the rest fold under "more".
- Every applied change is undoable individually from the change log.
- Settings let a user move categories between tiers, up to "auto-accept everything except the LLM and
  fact-locked spans". The LLM tier can never be auto-accepted silently; at most "accept all LLM
  suggestions" as an explicit, visible action.
- **Meaning-drift guard** for LLM suggestions: limit them to span-level edits (one sentence); reject any
  that change a fact-locked token, exceed an edit-size threshold, or fall below a semantic-similarity
  threshold; never present a suggestion longer than ~1.5x the original span.

## 6. Constraints

- **Free and open source.** Paid features only if something genuinely needs servers (none in v1).
- **Local-first and private.** Works fully offline after install.
- **Easy setup.** Single portable download per OS, per-user install, **no admin**, runs from a user
  folder; works on locked-down work and university laptops. Grammar-only use requires no model download.
- **Cross-platform**: Windows, macOS, Linux across the v1 family (ODF users are often on Linux/Mac);
  Windows ships first (see staging in §7).
- **English first.** Architecture should not prevent adding languages later (Indian languages planned).
- **Ordinary hardware**: must be usable on an 8 GB RAM laptop without a GPU. The rules pass must feel
  instant; the LLM pass may take seconds per paragraph and must show progress and be cancellable.

## 7. Decided "how" (owner's decisions)

- **Independent app**, not a fork of Handy or VoiceLink. Proofreading is the heart; dictation is a
  later module.
- **Stack: hybrid.** Tauri 2 desktop shell (thin Rust layer: window, file dialogs, launching the LLM
  helper process, later dictation) + **TypeScript** for the engine and UI (React). The owner is strongest
  in TypeScript and will learn Rust gradually.
- **Grammar engine:** Harper via `harper.js` (WebAssembly).
- **Local AI:** llama.cpp as a bundled/side-loaded helper process; model downloaded on demand.
- **Google Docs:** download/re-upload in v1; add-on later.
- **English first**, Indian languages later.
- **"Reads naturally" AI pass ships in v1** as an optional download.
- **Name:** `writing-check` (working title). Project folder: `writing-check`.
- **Signing:** ship unsigned at first (document the SmartScreen "Run anyway" / macOS "Open Anyway"
  steps); apply for free open-source signing (SignPath Foundation) before the public release. Never try
  to get around organisational policies that block unsigned software; the locked-down promise is "no
  admin, no installs, no add-ins", not "runs despite IT policy".
- **Team and pace:** solo, no deadline. Build and test feature by feature; private builds before any
  public release.
- **Staging:** v1.0 = Windows + .docx/.txt/.md; v1.1 = .odt + macOS + Linux; then dictation, Google Docs
  add-on, Indian languages. Cross-platform stays a v1-family goal, so nothing Windows-only goes into the
  core engine.

## 8. Left to the builder

- Specific LLM model choice (small instruct model, 1-4B, quantised) and prompt design, subject to §5's
  guard and §6's hardware floor.
- How .docx/.odt are edited internally (expected: edit text runs in the XML without re-serialising
  untouched parts, so formatting and unknown elements survive byte-for-byte). Handling of text that spans
  multiple runs, fields, hyperlinks, footnotes and tracked changes is the builder's to design and test.
- Fact-lock detection approach (patterns + Harper/NLP signals).
- Editor component, UI layout and visual design (aim: one window, very few settings).
- Packaging per OS within the no-admin constraint (portable zip/AppImage/.app) and the auto-update
  mechanism (opt-in).
- Extending the trust suite to .odt and .md inputs (the audit kit covers .docx, .tex and plain text today).
- Test strategy beyond §9; licence choice compatible with Harper (Apache-2.0) and llama.cpp (MIT).

## 9. Trust suite

Port the Turnitout audit kit (`make_corpus.py`, `analyze.py`; kept outside this repo) into the repo as the release gate.
Every release runs it against the app's own output and publishes the results:
- all planted facts survive; fact-locked spans unchanged;
- .docx/.odt structure and formatting identical apart from intended text edits;
- invisible characters removed, none added;
- no network requests during checking;
- LaTeX/code spans untouched (for .md/.txt containing them).

## 10. Success

- Someone installs it in under two minutes on a locked-down laptop and fixes a real .docx without help.
- A typical 1,500-word document needs **≤10 review decisions** to reach "done". *(Definition, Claude's
  call:)* a decision is any accept/reject the user must make in the default view (each Review item, each
  batch, each LLM suggestion); items folded under "more" don't count. Measured on a reference corpus of
  ~5 real-style documents per writing-goal preset, kept in the trust suite. This implies the LLM pass is
  budgeted to the few most awkward sentences, not every imperfect one.
- Zero meaning-changing auto-edits in the trust suite.
- It becomes someone's daily habit before publishing or submitting.
