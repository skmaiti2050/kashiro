# Word frequency data attribution

`en-wordfreq.json` is derived from **wordfreq 3.1.1** by Robyn Speer (https://github.com/rspeer/wordfreq),
English, `wordlist=large`. Kashiro uses it to rank spelling suggestions, to add likely words the
spell checker missed, and to tell common words from rare ones (the terms card and its common-words list,
`src/engine/wordlists/common.ts`).

- The wordfreq data is licensed under the Creative Commons Attribution-ShareAlike 4.0 International
  License: https://creativecommons.org/licenses/by-sa/4.0/ (legal code:
  https://creativecommons.org/licenses/by-sa/4.0/legalcode). `en-wordfreq.json` is shared under the same
  licence. (The wordfreq code is Apache-2.0; no wordfreq code is included here.)
- Citation: Robyn Speer. (2022). rspeer/wordfreq: v3.0 (v3.0.2). Zenodo. https://doi.org/10.5281/zenodo.7199437

## Changes

Filtered to lowercase a–z words (apostrophes kept, e.g. "don't"), top 100,000, frequencies rounded to one
decimal on the Zipf scale. Built with `npm run build:frequency` from a tab-separated export of
`wordfreq.top_n_list('en', 100000, wordlist='large')` with `zipf_frequency` (export sha256
`7bce41579da7ae1adc1e551dc2a1c2bbf9e6c5bce95be801f7f0fd0585d5a577`).

## Sources wordfreq is built on

As required by the wordfreq licence notes:

- **SUBTLEX** word lists (SUBTLEX-US, SUBTLEX-UK and others), created by **Marc Brysbaert et al.**
  SUBTLEX is freely available data: http://crr.ugent.be/programs-data/subtitle-frequencies
- **OPUS OpenSubtitles 2018** (http://opus.nlpl.eu/OpenSubtitles.php), whose data originates from
  **OpenSubtitles.org** (http://www.opensubtitles.org/).
- **Google Books Ngram Viewer**: http://books.google.com/ngrams (Google Books Ngrams and Syntactic Ngrams).
- The **Leeds Internet Corpus**, University of Leeds Centre for Translation Studies
  (http://corpus.leeds.ac.uk/list.html).
- **Wikipedia**, the free encyclopedia (http://www.wikipedia.org).
- **ParaCrawl**, a multilingual web crawl (https://paracrawl.eu).
