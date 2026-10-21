# Romanised Indian-language model attribution

`romanised-ngrams.json` holds character n-gram counts (orders 1–4) for ten romanised Indian languages (Hindi,
Bengali, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Punjabi and Urdu) and English. writing-check
uses them to tell a romanised Indian-language word that the English spell checker flags ("accha", "khub
bhalo", "konjam") from an English typo, for the "Words in Indian languages" card.

## Dakshina dataset (Indian-language counts)

- **The Dakshina dataset**, Google Research: https://github.com/google-research-datasets/dakshina
- Citation: Brian Roark, Lawrence Wolf-Sonkin, Christo Kirov, Sabrina J. Mielke, Cibu Johny, Işın Demirşahin
  and Keith Hall. 2020. *Processing South Asian Languages Written in the Latin Script: the Dakshina
  Dataset.* Proceedings of the 12th Language Resources and Evaluation Conference (LREC 2020), pages 2413–2423.
- Licence: Creative Commons Attribution-ShareAlike 4.0 International
  (https://creativecommons.org/licenses/by-sa/4.0/, legal code:
  https://creativecommons.org/licenses/by-sa/4.0/legalcode). `romanised-ngrams.json` is shared under the
  same licence.
- Copy used: the romanised parallel sentences as mirrored on Hugging Face,
  https://huggingface.co/datasets/suhani-sarvam/google-dakshina (`google-dakshina.csv`, 38,926,707 bytes,
  sha256 `8886730d2c020f8e7cceb784ede2b22e1472c4cacaa0ae79af514ff7cf7c5cf3`, last modified 2025-01-20).
  The mirror states no licence of its own, so the original dataset's licence applies.

## wordfreq (English counts)

The English counts come from `resources/frequency/en-wordfreq.json`, derived from wordfreq 3.1.1 by Robyn Speer
(CC BY-SA 4.0); see `resources/frequency/ATTRIBUTION.md` for its full attribution and sources.

## Changes

Built with `npm run build:romanised -- google-dakshina.csv`. Only the `roman` column is used, of the rows of
Hindi (`hi`), Bengali (`bn`), Tamil (`ta`), Telugu (`te`), Kannada (`kn`), Malayalam (`ml`), Marathi (`mr`),
Gujarati (`gu`), Punjabi (`pa`) and Urdu (`ur`); the Sindhi and Sinhala rows are not used. Of each language,
only the 80% train split is used (a fixed FNV-1a hash of each sentence; the other 20% is kept for tuning and
testing). The sentences were lowercased and split into a–z words; only the distinct words the app's English
spell checker flags were kept (English loanwords such as "park" were dropped). The English side is the a–z
words of the wordfreq list minus those Indian-language words. Each distinct word was counted once per
language, and only the resulting character n-gram counts are distributed: no sentences or word lists.

- S7 (first version): Hindi and Bengali.
- S7b: eight more languages (Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Punjabi and Urdu), from the
  same file.
