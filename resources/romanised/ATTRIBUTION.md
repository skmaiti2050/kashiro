# Romanised Hindi/Bengali model attribution

`romanised-ngrams.json` holds character n-gram counts (orders 1–4) for romanised Hindi, romanised Bengali
and English. writing-check uses them to tell a romanised Hindi or Bengali word that the English spell checker
flags ("accha", "khub bhalo") from an English typo, for the "Words in Hindi/Bengali" card.

## Dakshina dataset (Hindi and Bengali counts)

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

Built with `npm run build:romanised -- google-dakshina.csv`. Only the `roman` column of the Hindi (`hi`) and
Bengali (`bn`) rows is used, and only the 80% train split (a fixed FNV-1a hash of each sentence; the other 20%
is kept for tuning and testing). The sentences were lowercased and split into a–z words; only the distinct
words the app's English spell checker flags were kept (English loanwords such as "park" were dropped). The
English side is the a–z words of the wordfreq list minus those Hindi/Bengali words. Each distinct word was
counted once, and only the resulting character n-gram counts are distributed: no sentences or word lists.
