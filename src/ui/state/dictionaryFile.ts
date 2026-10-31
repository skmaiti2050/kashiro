import { isRecord } from '@/engine/modules';

/** Settings › Saving › Export dictionary on the web (web plan, Task 2): the file's name and format version. */
export const DICTIONARY_FILE_NAME = 'kashiro-dictionary.json';
const FORMAT_VERSION = 1;

/** The export file: {"version":1,"words":[…]}. */
export function dictionaryFileText(words: readonly string[]): string {
  return JSON.stringify({ version: FORMAT_VERSION, words }, null, 2);
}

/** The words in an export file, or null when `text` is not one (damaged JSON, another version, a non-text word). */
export function readDictionaryFile(text: string): string[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null; // not JSON: the caller says the file isn't a dictionary
  }
  if (!isRecord(value) || value.version !== FORMAT_VERSION || !Array.isArray(value.words)) return null;
  return value.words.every((word) => typeof word === 'string') ? value.words : null;
}
