# Trap catalogue

These are the inputs that found real damage in Kashiro's reviews. Use the groups that match the surfaces your change touches, and vary them: each fix so far was beaten by the shape next to it.

## Doubled words
- Before compounds: `for for-profit`, `and and/or`, `be be-bop`, `C C++`, `etc etc.`
- Legitimate doublings: `had had`, `that that`, `is is` in quoted speech, `bye bye`, `very very`, `no no`, `Walla Walla`, `Bora Bora`, Hindi-English `bas bas`
- Case and spacing variants: `THAT THAT`, `That That`, `had Had`, `had  had` (two spaces), the same doubling repeated so it forms a batch
- Across a line break, a sentence end, Markdown emphasis, list items, headings and table cells
- Alphabet and phonics pairs: `A a B b`, `a a, b b`
- Keywords written as words: `open files with with`, `the operators and and or`; a Markdown reference link `[the the]`

## a/an
- Labels and initials: `Class A office`, `Hepatitis A`, `Plan A`, `Priya A officer`, `Grades: A excellent`
- Variables: `Why does a equal b`, `Let a equal 5`
- `an` typed for `and`, `on` or `in`: `mother an father`, `form an hand it over`, `arrived an time`
- Sound not shown by the spelling: `an unidentified`, `a ewer`, `an onerous`, `an hour`, `a one-off`, `a European`, `an MBA`, `a usb`, `an sms`
- Other languages: `Fui a animal`, `Vamos a animal planet`
- Case: `A apple`, `AN Apple`, `A APPLE`

## Capitals and sentence starts
- Abbreviations: `Govt. of`, `etc. and`, `e.g. the`, `5 pm. Tomorrow`, `Jan. was`, `contd. from`, `Ph.D.`, `Mr. A`
- Spaced ellipsis `Hmm . . . yes`, `Yahoo! mail`, `a) the first point. b) the second`
- `i` as a variable, a roman numeral `(i)`, or in code `for i in range`

## Invisible and direction characters
- Inside words: `a m<U+200E>ean`, ZWJ/ZWNJ in Devanagari and Bengali (`क्<U+200D>ष`), `<U+FE0F>` and other variation selectors, emoji ZWJ sequences
- Before punctuation: `etc<U+200E>.`
- Bidi controls: unbalanced, nested isolates (LRI…PDI), an override such as RLO left open
- Others: U+00AD, U+2060, U+FEFF, U+180E, tag characters

## Whitespace and layout
- NBSP, U+3000, U+2028/2029, tabs, CR, LF and CRLF mixes, a lone CR
- Spaces in code, preformatted text, Markdown table cells, column-aligned text, `Name:      Rahul` forms, leading indentation

## Scripts and languages
- Hindi, Bengali and Tamil paragraphs; a Hindi lead-in to an English sentence; a Tamil quote in an English paragraph
- Danda `।` and `॥`, Devanagari and Bengali digits, combining marks, grapheme clusters

## Paths that apply edits
- Accepting a single card after other cards shifted the offsets; undo
- An open card or preview while the text changes. Ids are offsets (`paraId:start:end:kind`), so also try **new text under the same ids** (a line moved with Alt+↑, a paste over the span, an undo, typing without a pause) and **the same words from another place under the same ids** (swap two equal-length lines that share a misspelling, one of them marked "sic")
- A re-check with no text change (a settings or preset change) while a preview is open
- An edit from another surface while a preview is open: the AI helper's Apply, another card's Apply, the change log's Undo
- Paragraphs that are, or become, identical across a re-check or a saved-review resume (deleting, pasting or retyping one): accepted, rejected and AI decisions must stay on their own paragraph. `probe.mts` never re-checks, so drive this with a harness that edits the text and re-checks
- An accepted fix plus an AI rewrite of the same sentence, then typing elsewhere: both must survive
- A rule card over text an accepted AI rewrite (or any applied edit) has already replaced; applying it must not revert the rewrite. The probe doesn't run the AI helper, so drive this with a harness that accepts an AI edit through the session
- UI harnesses: a jsdom harness around a changed copy of `src/ui` outside the repo needs `NODE_PATH` set to the repo's `node_modules` and a global `React`. To check which parts of a UI rule the tests cover, remove one part in that copy and see whether any test goes red
- "Review and apply all" with default ticks on every batch card
- Settings: every opted-in kind, old or corrupt stored settings
- carryDecisions on re-check; the change-log row (context, invisible-character names, wrapping, `lang`)
