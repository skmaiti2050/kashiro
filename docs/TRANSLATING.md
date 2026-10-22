# Translating writing-check

The app's interface (menus, cards, messages, screen-reader text) can be shown in any language. The text
being **checked** is always English; that is separate, and not part of these files.

Languages today: English (the source), Hindi (`hi`) and Bengali (`bn`). Both translations are drafts marked
**needs native review**.

## The files

One flat JSON catalogue per language in `src/ui/i18n/`:

```
src/ui/i18n/en.json   the source: every key, in English
src/ui/i18n/hi.json   Hindi
src/ui/i18n/bn.json   Bengali
```

Each file is a map from key to message:

```json
{
  "@@locale": "bn",
  "@@status": "needs native review",
  "@@note": "Draft in simple everyday Bengali (India)…",

  "toolbar.open": "খুলুন",
  "status.words": "{count, plural, other {#টি শব্দ}}"
}
```

- Entries starting with `@@` describe the file; they are not messages. Translation tools should treat
  them as read-only (or exclude them).
- A key missing from a translation shows in English, never as the raw key. The tests do not allow that
  in a release (see [Tests](#tests)).

## Keys

- A key is `area.name`: `toolbar.open`, `card.accept`, `error.saveAgain`. The area is the screen or the
  part of the app (`toolbar`, `card`, `settings`, `reading`, `shortcuts`, `error`…).
- Keys appear in the code as string literals (`t.t('toolbar.open')`), so a search finds every use, and a
  test finds unused keys.
- One key, one meaning. If the same English word means two things ("Review" the panel, "Review" the
  button), there are two keys, because other languages may need two words.
- Never translate a key, only its message.

Some groups are worth knowing:

| Keys | What they are |
|---|---|
| `kind.*` | Kinds of suggestion ("Words joined or split"). The rule's own name (`BoundaryError`) is never shown. |
| `category.*` | The six categories on cards and underlines. |
| `explain.*` | Card explanations. The engine's and the most common Harper messages are matched to these keys (`src/ui/state/plainMessages.ts`). |
| `explain.harper` | Any other Harper message, shown as it is in English and marked “(explanation in English)” on the card. Its message is just `{text}`. |
| `unplaceable.*`, `reason.*` | Why an edit could not be written into the file, by the file formats' exact English (`src/ui/state/engineReasons.ts`). |
| `speech.*`, `announce.*`, `verb.*` | What screen readers and Read aloud say. They are heard, not seen, so read them aloud when you review. |

## Message syntax (ICU MessageFormat)

Messages use ICU MessageFormat (the `react-intl` library). Keep everything inside braces exactly as it is,
except the words inside plural and select branches.

| Syntax | Example | Notes |
|---|---|---|
| A value | `Saved as {path}` | Keep `{path}`; move it wherever your grammar needs it. |
| A number | `{count, number}` | Formatted for the language: `1,20,000` in en-IN, `১,২০,০০০` in Bengali. Never write digits yourself. |
| A plural | `{count, plural, one {# word} other {# words}}` | `#` is the number. Branch names are fixed CLDR words (below), not translations. |
| An exact number | `{count, plural, =0 {No fixes} other {# fixes}}` | `=0` wins over the category, for a sentence that reads better without “0”. |
| A choice | `{mode, select, tracked {…} other {…}}` | Translate only the text inside the inner braces. |
| A tag | `<b>File → Download</b>` | Keep the tags; the words inside can be translated. |

### Plurals by language

Every plural needs an `other` branch. Use only the categories your language has (CLDR):

| Language | Categories | Notes |
|---|---|---|
| English | `one`, `other` | `one` is exactly 1. |
| Hindi | `one`, `other` | `one` is 0 and 1. The word often doesn't change, so both branches may be the same. |
| Bengali | `one`, `other` | `one` is 0 and 1. With the counter “টি” the noun doesn't change, so `other` alone is enough. |

Languages with more forms (Arabic: `zero`, `one`, `two`, `few`, `many`, `other`) should list each one.

### Apostrophes and quotes

In ICU, a straight apostrophe `'` starts quoted text and can hide a placeholder. The catalogues use the
typographic ’ and “ ” instead. Use those, or the quotation marks of your language.

## What stays in English

- The user's document: its words, quoted on cards (“recieve”), and file names.
- Harper's own messages (`explain.harper`), until the engine's messages are keyed.
- Key caps (`Ctrl`, `Enter`, `F1`) and product names (Word, Google Docs, Windows, Atkinson Hyperlegible).
- Menu paths in another app that the user will see in English, e.g. `File → Download` in Google Docs.
  Translate them only if that app is usually used in your language.
- Language names: each language is shown in its own script (`हिन्दी`, `বাংলা`) and is never translated.

## Writing style

- Simple, everyday words, the way the app's users would speak. Not word-for-word from English.
- Short: buttons and labels have little room. The layout wraps longer text, but shorter is easier to read.
- Use the same word for the same thing everywhere (one word for “card”, one for “dismiss”).
- Address the user the polite way that software in your language usually does (Hindi: आप; Bengali: আপনি).

## Adding a language

1. Copy `src/ui/i18n/en.json` to `src/ui/i18n/<code>.json` (`ta` for Tamil, `ur` for Urdu). Set
   `@@locale`, `@@status: "needs native review"` and `@@note`, and translate every message.
2. `src/ui/i18n/catalogues.ts`: import the file, add the code to `UiLocale`, and return it from
   `messagesFor`.
3. `src/ui/i18n/locale.ts`: add the code to `UI_LANGUAGES`, its own name to `LANGUAGE_NAMES`, and to
   `systemLanguage` so Windows in that language picks it. Check `formatLocaleFor` gives the right region
   for numbers (Indian languages use `-IN`).
4. **Script.** If the language needs a script the bundled fonts lack, add `@font-face` rules for its
   `@fontsource` subset (regular and bold, `.woff2` only, with the subset's `unicode-range` from the
   package's full CSS) in `src/ui/fonts.css`, add the family to `--indic-fonts` in `src/ui/app.css`, and
   add the font with its licence to `resources/fonts/ATTRIBUTION.md`. A new dependency needs the owner's
   approval. Nothing may be loaded from the network.
5. **Right to left.** Arabic, Persian, Hebrew and Urdu are already in `RTL_LANGUAGES`, so the page gets
   `dir="rtl"`. The CSS uses logical properties only (`margin-inline-start`, not `margin-left`; a test
   enforces this), so the layout mirrors by itself. The document text stays English, left to right.
6. **Tests.** Add the catalogue to `TRANSLATIONS` in `tests/ui/i18n.test.ts`, add a plural test for the
   language, and add it to the axe test in `tests/dom/language.test.tsx`.

## Needs native review

A machine or a non-native speaker may draft a catalogue, but it ships marked:

```json
"@@status": "needs native review"
```

A native speaker reviews it in the running app (the screens in the task report's checklist), then
changes the status to `"reviewed"` with their name and the date in `@@note`. A changed English message
makes its translations need review again; in Weblate or Crowdin that is the “needs editing” or
“fuzzy” flag.

## Translation tools (Weblate, Crowdin)

The catalogues are ready to connect:

- Format: flat JSON, key → ICU message (Weblate: “JSON file”; Crowdin: “JSON” with ICU syntax).
- Source language file: `src/ui/i18n/en.json`; translation files: `src/ui/i18n/<code>.json`.
- Turn on the ICU MessageFormat check (Weblate's `icu-message-format` flag), so a broken plural or a
  renamed placeholder is caught before it is saved.
- Exclude the `@@` entries, or mark them read-only.

## Tests

`npm test` checks, for every catalogue:

- every English key exists in it, and it has no key English lacks;
- every key is used in the code (no unused keys);
- every message parses and formats, and keeps the same placeholders as English;
- plurals and numbers come out right in English, Hindi and Bengali (en-IN: `1,20,000`);
- the pseudo-locale (below) shows no untranslated text and nothing overflows the main screens;
- switching language at runtime updates the whole UI; axe finds no serious problems in each language.

## The pseudo-locale (en-XA)

Development builds (`npm run dev`) offer **Pseudo-locale (en-XA)** in Settings › App language. Every
message becomes accented, bracketed and about 35% longer: `Save options` → `[Šàṽé öþţîöñš ~~~~]`.

- Plain English on screen is text that skipped the catalogue: a bug.
- A missing `[` or `]` means text is cut off.
- The extra length shows where a longer translation would not fit.
