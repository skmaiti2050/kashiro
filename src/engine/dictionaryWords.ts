/**
 * How personal-dictionary entries match words (Task F20 item 9, owner): a lowercase entry accepts the word in any
 * case ("vantix": vantix, Vantix, VANTIX); any other entry accepts itself and its all-caps form ("Vantix": Vantix,
 * VANTIX; "VPC": VPC). Harper accepts only the entry itself for a capitalised one, and keeps one case per word, so
 * the check also drops the flags an entry accepts (isDictionaryWord). Since Task F29 an added title-case word is
 * stored in lowercase (storedForm).
 */

/**
 * A word's form for comparing: composed (NFC), lowercase without a locale, and the dotted "i̇" that the Turkish
 * capital "İ" lowercases to read as "i" ("İstanbul" and "istanbul", "Café" and a decomposed "café" are one word;
 * Task F21c, review M-27).
 */
const folded = (word: string) => word.normalize('NFC').toLowerCase().replace(/i̇/g, 'i');

const isLowercase = (word: string) => word === word.toLowerCase();

/**
 * First letter a capital, the rest lowercase with at least one cased letter ("Cutover", "Mumbai"; not "ARN", "X",
 * "DBInstances" or "iPhone"): a capital that only marks a sentence start or a name, not a meaning (Task F29).
 */
function isTitleCase(word: string): boolean {
  const [first = '', ...rest] = [...word];
  const tail = rest.join('');
  return first !== first.toLowerCase() && isLowercase(tail) && tail !== tail.toUpperCase();
}

/**
 * The entry stored for a word the user adds (Task F29, owner): composed (NFC), and in lowercase when it is title
 * case, so it accepts every case ("Cutover" → "cutover"). ALL CAPS and internal capitals ("ARN", "DNSName") carry
 * meaning and are stored as written.
 */
export function storedForm(word: string): string {
  const composed = word.normalize('NFC');
  return isTitleCase(composed) ? folded(composed) : composed;
}

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
  return dictionaryMatcher(dictionary)(word);
}

/**
 * A test for "some entry of `dictionary` accepts the word" (dictionaryAccepts), with the dictionary read once into
 * two sets: a check asks it for every spelling flag.
 */
export function dictionaryMatcher(dictionary: readonly string[]): (word: string) => boolean {
  const anyCase = new Set<string>();
  const exact = new Set<string>();
  for (const entry of dictionary) {
    if (isLowercase(entry)) {
      anyCase.add(folded(entry));
      continue;
    }
    const composed = entry.normalize('NFC');
    exact.add(composed);
    exact.add(composed.toUpperCase());
  }
  return (word) => anyCase.has(folded(word)) || exact.has(word.normalize('NFC'));
}

/**
 * The dictionary with `word` added, one entry per word (Task F21 item G, owner): a lowercase word replaces its other
 * cases ("vantix" drops "Vantix", "vpc" drops "VPC"), since it accepts them all; a word an entry already accepts
 * ("VANTIX" with "vantix" there) adds nothing. The word is stored in its storedForm ("Cutover" as "cutover").
 */
export function withWordAdded(dictionary: readonly string[], word: string): string[] {
  const stored = storedForm(word);
  if (isDictionaryWord(dictionary, stored)) return [...dictionary];
  if (!isLowercase(stored)) return [...dictionary, stored];
  return [...dictionary.filter((entry) => folded(entry) !== folded(stored)), stored];
}

/**
 * A dictionary saved before Task F29 with its title-case entries in lowercase, each entry re-added as withWordAdded
 * adds it ("Cutover" and "cutover" become one "cutover"). It only widens what is accepted. The same list when it has
 * no title-case entry, so the caller saves only a changed one.
 */
export function withTitleCaseLowered(dictionary: string[]): string[] {
  if (!dictionary.some((entry) => isTitleCase(entry.normalize('NFC')))) return dictionary;
  return dictionary.reduce(withWordAdded, []);
}

/**
 * The dictionary with its case and NFC variants collapsed into one entry each (F22 item 1, "Merge duplicates"):
 * the lowercase form when the group has one (it accepts every case), otherwise the first as written, composed. Each
 * entry keeps the place of its group's first entry. `merged` is how many entries went.
 */
export function withDuplicatesMerged(dictionary: readonly string[]): { dictionary: string[]; merged: number } {
  const groups = new Map<string, string[]>();
  for (const entry of dictionary) groups.set(folded(entry), [...(groups.get(folded(entry)) ?? []), entry]);
  const kept = [...groups.values()].map((group) => (group.length === 1 ? group[0] : (group.find(isLowercase) ?? group[0]).normalize('NFC')));
  return { dictionary: kept, merged: dictionary.length - kept.length };
}

/** How many entries "Merge duplicates" would remove (0: the button is disabled). */
export function duplicateCount(dictionary: readonly string[]): number {
  return withDuplicatesMerged(dictionary).merged;
}
