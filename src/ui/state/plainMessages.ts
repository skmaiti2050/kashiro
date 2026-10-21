/**
 * Card explanations in plain words (Task A1 item 6). Harper's messages that use grammar terms ("closed
 * compound noun", "infinitive marker") are rewritten for the card, the underline and read aloud; the
 * engine, the change log and the report keep Harper's own text. Measured on the 22 trust reference
 * documents: these are the messages with grammar terms they produce. Any other message is shown as it is.
 */
const REWRITES: [RegExp, string][] = [
  // Did you mean the closed compound noun “heatwave”?
  [/^Did you mean the closed compound noun “([^”]+)”\?$/, 'Did you mean “$1”, as one word?'],
  // `clay` is a mass noun.
  [/^`([^`]+)` is a mass noun\.$/, '“$1” is not usually counted, so it takes no plural and no “a”.'],
  // The word `chilli` is a mass noun and should not be pluralized.
  [/^The word `([^`]+)` is a mass noun and should not be pluralized\.$/, '“$1” is not usually counted, so it takes no plural.'],
  [/^Incorrect indefinite article\.$/, 'Use “a” before a consonant sound and “an” before a vowel sound.'],
  [/^Did you mean the definite article\?$/, 'Did you mean “the”?'],
  [/^You may be missing a preposition here\.$/, 'A small linking word such as “to”, “of” or “in” may be missing here.'],
  [/^There are too many personal pronouns in sequence here\.$/, 'Too many words like “I”, “you” or “they” in a row here.'],
  // The adverbs of frequency ‘usually’ and ‘monthly’ are either redundant or contradictory
  [/^The adverbs of frequency ‘([^’]+)’ and ‘([^’]+)’ are either redundant or contradictory\.?$/, '“$1” and “$2” both say how often: keep one.'],
  [/^The construction `one of the \.\.\.` should use a plural noun\.$/, 'After “one of the”, use the plural (“one of the books”).'],
  // Insert `to` to complete the infinitive (e.g., `need to talk`).
  [/^Insert `to` to complete the infinitive \(e\.g\., `([^`]+)`\)\.$/, 'Add “to” here, as in “$1”.'],
  [/^This word might be a phrasal verb rather than a compound noun\.$/, 'If this is an action, write it as two words (“set up”, not “setup”).'],
  [/^Use the infinitive marker `to` here instead of the adverb `too`, which indicates excess degree\.$/, 'Use “to” here: “too” means “also” or “more than enough”.'],
  [/^The form of the verb must agree in grammatical number with the pronoun\.$/, 'Make the verb match the word before it (“he walks”, “they walk”).'],
  [/^Make the verb agree with its subject\.$/, 'Make the verb match its subject (“he walks”, “they walk”).'],
  // Two sentences, the second about `it's`: both are replaced.
  [/^Use the possessive pronoun `its` \(without an apostrophe\) to show ownership\..*$/s, 'Use “its” (no apostrophe) for ownership. “It’s” means “it is” or “it has”.'],
  // Drop the repeated verb form so only one instance of `be` remains.
  [/^Drop the repeated verb form so only one instance of `([^`]+)` remains\.$/, 'Remove the repeated “$1”.'],
  // You probably mean the adverb `every day` here.
  [/^You probably mean the adverb `([^`]+)` here\.$/, 'You probably mean “$1” (two words) here.'],
];

/** The card's explanation for a flag's message: plain words where Harper uses grammar terms. */
export function plainMessage(message: string): string {
  for (const [pattern, plain] of REWRITES) {
    if (pattern.test(message)) return message.replace(pattern, plain);
  }
  return message;
}
