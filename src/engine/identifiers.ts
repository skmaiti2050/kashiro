import type { Span } from './types';
import { overlaps } from './sessionTypes';
import { zipfOf } from './suggestions/frequency';
import { TECH_WORDS } from './wordlists/tech';
import { SHORT_TECHNICAL_WORDS, TECHNICAL_WORDS } from './wordlists/technical';

/**
 * Identifiers no spelling, word or capital rule may touch (Task F21 item E, owner): "(ami-0123456789abcdef0)" got a
 * Spelling card suggesting ")" for "6789abcdef0", and UUID groups and SHAs got word suggestions ("f2a9c1e" → "face").
 * Harper splits these tokens, so each flag is judged with the text around it.
 */

/** A cloud resource ID: a known prefix, a hyphen, then letters and digits with a digit ("vpc-0a1b2c3d4e5f60718"). */
const RESOURCE_ID = /(?<![\p{L}\p{N}_-])(?:ami|vpc|subnet|sg|i|igw|rtb|eni|vol|snap)-(?=[a-z0-9]*\d)[a-z0-9]{6,}(?![\p{L}\p{N}_])/giu;
/** A UUID: "3f2a9c1e-7b4d-4e8a-9f0c-1d2e3f4a5b6c". */
const UUID = /(?<![\p{L}\p{N}_-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\p{L}\p{N}_-])/giu;
/** An Amazon resource name, up to the next space: "arn:aws:iam::123456789012:role/deploy-role-prod". */
const ARN = /(?<![\p{L}\p{N}_-])arn:[a-z0-9-]+:\S*/giu;
/**
 * Six or more hex characters with two digits or more: a hash, a short git SHA or an ID part ("3911a5b"; not
 * "decade", nor the typos "added1" and "faced2", Task F21c review M-26).
 */
const HEX_LIKE = /^(?=(?:[a-f]*\d){2})[0-9a-f]{6,}$/i;
/** Letters and digits mixed back and forth at least twice ("bld9x7k2q", "jb3kq9z"; not "y0u", "th9s", "mp4"). */
const MIXED = /^(?:(?:\p{L}+\p{N}+){2,}\p{L}*|(?:\p{N}+\p{L}+){2,}\p{N}*)$/u;
/** One letter or digit, e.g. "a", "7". */
export const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Three or more lowercase parts joined by hyphens: "vantix-db-mumbai", "my-app-prod-1", "state-of-the-art". */
const HYPHEN_JOINED = /^[a-z0-9]+(?:-[a-z0-9]+){2,}$/;
/** A letter, digit or hyphen: what a hyphen-joined token is made of. */
const TOKEN_CHAR = /[\p{L}\p{N}-]/u;
/** A part with no vowel ("db", "ecr") or with a digit ("1", "ec2"): written like an abbreviation, not a word. */
const ABBREVIATION_LIKE = /^[^aeiouy]+$|\d/;
/** Zipf 3.0 is about once per million words: "mumbai" (4.0), "prod" (3.3) are common; "vantix" (0) is not. */
const COMMON_WORD_ZIPF = 3.0;
const TECH_WORD_SET: ReadonlySet<string> = new Set([...TECH_WORDS, ...TECHNICAL_WORDS, ...SHORT_TECHNICAL_WORDS]);

/**
 * True when `span` of `text` is in a hyphen-joined resource name (Task F26 item 5): three or more lowercase parts,
 * at least one written like an abbreviation or a tech word ("db", "1", "ecr"), and not every part a common English
 * word. "state-of-the-art" and "mother-in-law" stay prose; so does a typo in one ("state-of-teh-art": no part looks
 * like an abbreviation), which keeps its spelling card.
 */
function inHyphenJoinedName(text: string, span: Span): boolean {
  let start = span.start;
  let end = span.end;
  while (start > 0 && TOKEN_CHAR.test(text[start - 1])) start--;
  while (end < text.length && TOKEN_CHAR.test(text[end])) end++;
  const token = text.slice(start, end).replace(/^-+|-+$/g, '');
  if (!HYPHEN_JOINED.test(token)) return false;
  const parts = token.split('-');
  if (parts.every((part) => zipfOf(part) >= COMMON_WORD_ZIPF)) return false;
  return parts.some((part) => ABBREVIATION_LIKE.test(part) || TECH_WORD_SET.has(part));
}

/** The run of letters and digits around `span` of `text`: "0123456789abcdef0" around "6789abcdef0". */
function runAround(text: string, span: Span): string {
  let start = span.start;
  let end = span.end;
  while (start > 0 && LETTER_OR_DIGIT.test(text[start - 1])) start--;
  while (end < text.length && LETTER_OR_DIGIT.test(text[end])) end++;
  return text.slice(start, end);
}

/** True when `span` of `text` overlaps a match of `re` (a global pattern). */
function inMatch(text: string, span: Span, re: RegExp): boolean {
  for (const m of text.matchAll(re)) if (overlaps(span, { start: m.index!, end: m.index! + m[0].length })) return true;
  return false;
}

/**
 * True when `span` of `text` is part of an identifier: a resource ID with its prefix ("vpc" in "vpc-032d…", "i" in
 * "i-0abc…"), a UUID, an ARN, or a run of letters and digits that is hex-like ("6789abcdef0", "3911a5b") or mixes
 * letters and digits more than once ("bld9x7k2q"), or a hyphen-joined resource name ("vantix-db-mumbai"). A word
 * with one slipped digit ("y0u", "added1") is still a word.
 */
export function isInIdentifier(text: string, span: Span): boolean {
  const run = runAround(text, span);
  if (HEX_LIKE.test(run) || MIXED.test(run) || inHyphenJoinedName(text, span)) return true;
  return inMatch(text, span, RESOURCE_ID) || inMatch(text, span, UUID) || inMatch(text, span, ARN);
}
