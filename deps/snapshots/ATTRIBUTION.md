# Snapshot excerpts attribution

The snapshots in this folder record how the dependencies behave (Task S8, see `docs/UPGRADING.md`). They hold
only short excerpts (at most 40 characters per flagged text or suggestion) plus offsets, never whole texts.

## harper.json

- `reference/…` and `probes/…`: texts written for this project (`trust/reference`, `scripts/deps/harperProbes.ts`),
  Apache-2.0.
- `samples/…`: flags on texts from a local sample pack that is not part of the repository
  (`scripts/deps/samplePack.ts`). Excerpts are stored only for these:
  - Wikipedia, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). The excerpts are
    shared under the same licence:
    - "Monsoon of South Asia", https://en.wikipedia.org/wiki/Monsoon_of_South_Asia, Wikipedia contributors
    - "Indian Railways", https://en.wikipedia.org/wiki/Indian_Railways, Wikipedia contributors
    - "Ayurveda", https://en.wikipedia.org/wiki/Ayurveda, Wikipedia contributors
  - Public domain: Rabindranath Tagore, *The Home and the World* (Project Gutenberg #7166); Jane Austen,
    *Pride and Prejudice* (Project Gutenberg #1342); *The Federalist* No. 10 (Wikisource, Dawson edition).
  - The two Europe PMC articles (CC BY 4.0) and the Right to Information Act, 2005 (Wikisource) keep kinds,
    offsets and a hash of each flag only: no text.

## data.json

The 50 dictionary lookups quote the first 60 characters of a definition from **Open English WordNet 2025**
(CC BY 4.0), derived from Princeton WordNet; see `resources/dictionary/ATTRIBUTION.md`. The word lists are
recorded as counts and hashes only.
