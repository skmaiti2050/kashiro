/**
 * How personal-dictionary entries match words (Task F20 item 9, owner): a lowercase entry accepts the word in any
 * case ("vantix": vantix, Vantix, VANTIX); any other entry accepts itself and its all-caps form ("Vantix": Vantix,
 * VANTIX; "VPC": VPC). Harper accepts only the entry itself for a capitalised one, and keeps one case per word, so
 * the check also drops the flags an entry accepts (isDictionaryWord).
 */

/**
 * A word's form for comparing: composed (NFC), lowercase without a locale, and the dotted "i̇" that the Turkish
 * capital "İ" lowercases to read as "i" ("İstanbul" and "istanbul", "Café" and a decomposed "café" are one word;
 * Task F21c, review M-27).
 */
const folded = (word: string) => word.normalize('NFC').toLowerCase().replace(/i̇/g, 'i');

const isLowercase = (word: string) => word === word.toLowerCase();

/**
 * The entry to store for a word the user added from its places: lowercase when any place is written in lowercase
 * (the user wrote it so, and it then accepts every place), else the first capitalised spelling, else the first.
 * A card's first place may be a sentence start ("Vantix is…"): storing that left "vantix" flagged on reopen.
 */
export function dictionaryForm(spellings: readonly string[]): string {
  const lower = spellings.find(isLowercase);
  if (lower !== undefined) return lower;
  return spellings.find((w) => w !== w.toUpperCase()) ?? spellings[0];
}

/** True when the dictionary entry `entry` accepts `word` (see the case rule above). */
export function dictionaryAccepts(entry: string, word: string): boolean {
  if (isLowercase(entry)) return folded(word) === folded(entry);
  const [e, w] = [entry.normalize('NFC'), word.normalize('NFC')];
  return w === e || w === e.toUpperCase();
}

/** True when some entry of `dictionary` accepts `word`. */
export function isDictionaryWord(dictionary: readonly string[], word: string): boolean {
  return dictionary.some((entry) => dictionaryAccepts(entry, word));
}

/**
 * The dictionary with `word` added, one entry per word (Task F21 item G, owner): a lowercase word replaces its other
 * cases ("vantix" drops "Vantix", "vpc" drops "VPC"), since it accepts them all; a word an entry already accepts
 * ("Vantix" with "vantix" there) adds nothing. The word is stored as written, composed (NFC).
 */
export function withWordAdded(dictionary: readonly string[], word: string): string[] {
  const composed = word.normalize('NFC');
  if (isDictionaryWord(dictionary, composed)) return [...dictionary];
  if (!isLowercase(composed)) return [...dictionary, composed];
  return [...dictionary.filter((entry) => folded(entry) !== folded(composed)), composed];
}
