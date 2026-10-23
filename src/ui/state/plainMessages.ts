import type { Candidate } from '@/engine/types';
import { CONFUSABLE_MESSAGES } from '@/engine/confusables';
import type { MessageKey } from '../i18n/catalogues';
import { msg, type Message } from '../i18n/message';

/** What a rewrite needs: the pattern's captured words and the flagged text. */
type Rewrite = (captured: string[], original: string) => Message;

/**
 * Card explanations as translatable messages (Task A1 item 6, Task L1). Harper's messages that use grammar
 * terms ("closed compound noun", "infinitive marker") get plain words; the engine, the change log's
 * report and the CLI keep Harper's own text. Measured on the 22 trust reference documents: these are the
 * messages with grammar terms they produce.
 */
const REWRITES: [RegExp, Rewrite][] = [
  // Did you mean the closed compound noun “heatwave”?
  [/^Did you mean the closed compound noun “([^”]+)”\?$/, ([word]) => msg('explain.oneWord', { word })],
  // `clay` is a mass noun.
  [/^`([^`]+)` is a mass noun\.$/, ([word]) => msg('explain.notCounted', { word })],
  // The word `chilli` is a mass noun and should not be pluralized.
  [/^The word `([^`]+)` is a mass noun and should not be pluralized\.$/, ([word]) => msg('explain.noPlural', { word })],
  [/^Incorrect indefinite article\.$/, () => msg('explain.aOrAn')],
  [/^Did you mean the definite article\?$/, () => msg('explain.the')],
  [/^You may be missing a preposition here\.$/, () => msg('explain.linkingWord')],
  [/^There are too many personal pronouns in sequence here\.$/, () => msg('explain.pronouns')],
  // The adverbs of frequency ‘usually’ and ‘monthly’ are either redundant or contradictory
  [/^The adverbs of frequency ‘([^’]+)’ and ‘([^’]+)’ are either redundant or contradictory\.?$/, ([first, second]) => msg('explain.howOften', { first, second })],
  [/^The construction `one of the \.\.\.` should use a plural noun\.$/, () => msg('explain.oneOfThe')],
  // Insert `to` to complete the infinitive (e.g., `need to talk`).
  [/^Insert `to` to complete the infinitive \(e\.g\., `([^`]+)`\)\.$/, ([example]) => msg('explain.addTo', { example })],
  [/^This word might be a phrasal verb rather than a compound noun\.$/, (_, original) => msg('explain.twoWords', { word: original })],
  [/^Use the infinitive marker `to` here instead of the adverb `too`, which indicates excess degree\.$/, () => msg('explain.toToo')],
  [/^The form of the verb must agree in grammatical number with the pronoun\.$/, () => msg('explain.verbMatchesWord')],
  [/^Make the verb agree with its subject\.$/, () => msg('explain.verbMatchesSubject')],
  // Two sentences, the second about `it's`: both are replaced.
  [/^Use the possessive pronoun `its` \(without an apostrophe\) to show ownership\..*$/s, () => msg('explain.its')],
  // Drop the repeated verb form so only one instance of `be` remains.
  [/^Drop the repeated verb form so only one instance of `([^`]+)` remains\.$/, ([word]) => msg('explain.repeated', { word })],
  // You probably mean the adverb `every day` here.
  [/^You probably mean the adverb `([^`]+)` here\.$/, ([word]) => msg('explain.probablyMean', { word })],
];

/** The rewrite patterns, for the test that each still matches a real Harper message (tests/deps/harperMessages.test.ts). */
export const REWRITE_PATTERNS: readonly RegExp[] = REWRITES.map(([pattern]) => pattern);

/** The confusables rule's lines (engine/confusables), by their English text. */
const CONFUSABLE_EXPLANATIONS = new Map<string, MessageKey>([
  [CONFUSABLE_MESSAGES.caste, 'explain.caste'],
  [CONFUSABLE_MESSAGES.lose, 'explain.lose'],
  [CONFUSABLE_MESSAGES.onCall, 'explain.onCall'],
  [CONFUSABLE_MESSAGES.copeWith, 'explain.copeWith'],
]);

/** The engine's own hygiene message: "Invisible character (U+200B ZERO WIDTH SPACE)". */
const INVISIBLE_MESSAGE = /\((U\+[0-9A-F]{4,6}) ([^)]+)\)$/;

/**
 * The card's explanation for a flag, as a message in the UI language: the engine's own messages and the
 * rewrites above are translated; any other Harper message stays English (explain.harper, see englishOnly).
 */
export function explanation({ message, original, kind, source }: Pick<Candidate, 'message' | 'original' | 'kind' | 'source'>): Message {
  if (kind === 'Contraction' && source === 'preset') return msg('explain.contraction');
  const confusable = source === 'preset' ? CONFUSABLE_EXPLANATIONS.get(message) : undefined;
  if (confusable) return msg(confusable);
  if (kind === 'Rewrite' && source === 'llm') return msg('explain.rewrite');
  const invisible = kind === 'Invisible' ? INVISIBLE_MESSAGE.exec(message) : null;
  // The character's Unicode name stays English: it is a standard name, not a sentence.
  if (invisible) return msg('explain.invisible', { code: invisible[1], name: invisible[2] });
  for (const [pattern, rewrite] of REWRITES) {
    const match = pattern.exec(message);
    if (match) return rewrite(match.slice(1), original);
  }
  return msg('explain.harper', { text: message });
}

/** True for a Harper message shown as it is, in English (the card says so and marks it lang="en"). */
export const englishOnly = (explained: Message): boolean => explained.key === 'explain.harper';
