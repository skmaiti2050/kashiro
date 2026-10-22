/**
 * The sample-pack fixtures in the Harper snapshot (Task S8). The pack itself is not in the repository (it
 * holds whole third-party texts); `npm run snapshots -- --samples <folder>` reads it from wherever it is.
 *
 * Excerpts are stored only for CC BY-SA and public-domain texts, with attribution in
 * deps/snapshots/ATTRIBUTION.md. The others (CC BY articles, and a statute whose status is not certain)
 * keep offsets and a hash only.
 */
export interface SampleFile {
  /** Path inside the sample-pack folder. */
  file: string;
  source: string;
  licence: string;
  storeText: boolean;
}

export const SAMPLE_FILES: SampleFile[] = [
  { file: 'general/monsoon-south-asia.txt', source: 'https://en.wikipedia.org/wiki/Monsoon_of_South_Asia', licence: 'CC-BY-SA-4.0', storeText: true },
  { file: 'general/indian-railways.txt', source: 'https://en.wikipedia.org/wiki/Indian_Railways', licence: 'CC-BY-SA-4.0', storeText: true },
  { file: 'general/ayurveda.txt', source: 'https://en.wikipedia.org/wiki/Ayurveda', licence: 'CC-BY-SA-4.0', storeText: true },
  { file: 'fiction/tagore-home-and-the-world.txt', source: 'https://www.gutenberg.org/ebooks/7166', licence: 'public domain', storeText: true },
  { file: 'fiction/austen-pride-and-prejudice.txt', source: 'https://www.gutenberg.org/ebooks/1342', licence: 'public domain', storeText: true },
  { file: 'legal/federalist-10.txt', source: 'https://en.wikisource.org/wiki/The_Federalist_(Dawson)/10', licence: 'public domain', storeText: true },
  { file: 'legal/rti-act-2005.txt', source: 'https://en.wikisource.org/wiki/Right_to_Information_Act,_2005', licence: 'Indian statute (not checked)', storeText: false },
  { file: 'medical/pmc13545719.txt', source: 'https://europepmc.org/article/PMC/PMC13545719', licence: 'CC-BY-4.0', storeText: false },
  { file: 'medical/pmc13579849.txt', source: 'https://europepmc.org/article/PMC/PMC13579849', licence: 'CC-BY-4.0', storeText: false },
];
