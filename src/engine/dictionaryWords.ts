/**
 * How personal-dictionary entries match words (Task F20 item 9, owner): a lowercase entry accepts the word in any
 * case ("vantix": vantix, Vantix, VANTIX); any other entry accepts itself and its all-caps form ("Vantix": Vantix,
 * VANTIX; "VPC": VPC). Harper accepts only the entry itself for a capitalised one, and keeps one case per word, so
 * the check also drops the flags an entry accepts (isDictionaryWord).
 */

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
  if (isLowercase(entry)) return word.toLowerCase() === entry;
  return word === entry || word === entry.toUpperCase();
}

/** True when some entry of `dictionary` accepts `word`. */
export function isDictionaryWord(dictionary: readonly string[], word: string): boolean {
  return dictionary.some((entry) => dictionaryAccepts(entry, word));
}
