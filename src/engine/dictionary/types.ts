// The file format shared by the build script (scripts/build-dictionary.ts) and the runtime lookup.
export type PosCode = 'n' | 'v' | 'a' | 'r';
/** [posCode, definition, example ("" when none), synonyms] */
export type SenseRow = [PosCode, string, string, string[]];
export interface DictionaryData {
  format: 1;
  /** lowercase lemma -> senses, grouped by part of speech in n, v, a, r order of first appearance */
  entries: Record<string, SenseRow[]>;
  /** inflected form -> lemma, from WordNet's own exception data (went -> go, geese -> goose) */
  exceptions: Record<string, string>;
}
