/**
 * The en-XA pseudo-locale (development only): "Save options" → "[Šàṽé öþţîöñš ~~~~]". Accented letters
 * show any text that skipped the catalogue (it stays plain ASCII), the brackets show text cut off at either
 * end, and the padding makes every message about 35% longer, as German or Hindi often are.
 */
const PLAIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ACCENTED = 'àƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ';
const ACCENT = new Map([...PLAIN].map((letter, i) => [letter, [...ACCENTED][i]]));

const GROWTH = 0.35;

/**
 * Accents the text of an ICU message, leaving its syntax alone. Braces alternate between syntax and text:
 * depth 0 is text, depth 1 is an argument ("count, plural, one "), depth 2 is a branch's text again. Tags
 * (<b>…</b>) and the plural "#" are kept as they are.
 */
export function pseudoLocalise(message: string): string {
  let depth = 0;
  let inTag = false;
  let letters = 0;
  let out = '';
  for (const char of message) {
    if (char === '{') depth++;
    else if (char === '}') depth--;
    const isText = depth % 2 === 0 && char !== '}';
    if (isText && char === '<') inTag = true;
    if (isText && !inTag && ACCENT.has(char)) {
      out += ACCENT.get(char);
      letters++;
    } else {
      out += char;
    }
    if (inTag && char === '>') inTag = false;
  }
  const padding = '~'.repeat(Math.max(1, Math.ceil(letters * GROWTH) - 1));
  return `[${out} ${padding}]`;
}
