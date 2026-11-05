import type { LanguageEngine } from './languageEngine';

/**
 * The engine for paragraphs mostly in a script nothing checks yet (#2a): no candidate of any kind, so their text is
 * written back exactly (never damage). The UI marks them "Not checked".
 */
export const notCheckedEngine: LanguageEngine = {
  capabilities: {
    id: 'none',
    proofreads: false,
    variants: [],
    hasCase: false,
    script: null,
    language: null,
    trust: { zeroClick: false, safeKinds: 'layoutOnly', ticks: 'none' },
  },
  check: async () => ({ found: [], uncheckedParagraphs: [] }),
  addWords: async () => {},
};
