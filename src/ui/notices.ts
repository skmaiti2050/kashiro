// About › Third-party notices: the committed notice files, imported as text at build time (no file access, no
// network). AboutDialog loads this module on demand, so the texts stay out of the main bundle.
import { version } from '../../package.json';
import dictionary from '../../resources/dictionary/ATTRIBUTION.md?raw';
import frequency from '../../resources/frequency/ATTRIBUTION.md?raw';
import romanised from '../../resources/romanised/ATTRIBUTION.md?raw';
import fonts from '../../resources/fonts/ATTRIBUTION.md?raw';
import i18n from '../../resources/i18n/ATTRIBUTION.md?raw';
import harper from '../../resources/harper/ATTRIBUTION.md?raw';

/** The app's version (package.json, kept equal to tauri.conf.json's by tests/ui/notices.test.ts). */
export const APP_VERSION: string = version;

/** One notice file. The title is the English name of what it covers; the text is the licence notice in English. */
export interface Notice {
  title: string;
  text: string;
}

export const THIRD_PARTY_NOTICES: readonly Notice[] = [
  { title: 'Open English WordNet (word lookup)', text: dictionary },
  { title: 'wordfreq (word frequencies)', text: frequency },
  { title: 'Dakshina dataset (words in Indian languages)', text: romanised },
  { title: 'Fonts (SIL Open Font License)', text: fonts },
  { title: 'react-intl, intl-messageformat and FormatJS (interface text)', text: i18n },
  { title: 'Harper (grammar and spelling checker)', text: harper },
];
