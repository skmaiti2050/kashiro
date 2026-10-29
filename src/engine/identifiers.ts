import type { Span } from './types';

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
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

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
  for (const m of text.matchAll(re)) if (span.start < m.index! + m[0].length && m.index! < span.end) return true;
  return false;
}

/**
 * True when `span` of `text` is part of an identifier: a resource ID with its prefix ("vpc" in "vpc-032d…", "i" in
 * "i-0abc…"), a UUID, an ARN, or a run of letters and digits that is hex-like ("6789abcdef0", "3911a5b") or mixes
 * letters and digits more than once ("bld9x7k2q"). A word with one slipped digit ("y0u", "added1") is still a word.
 */
export function isInIdentifier(text: string, span: Span): boolean {
  const run = runAround(text, span);
  if (HEX_LIKE.test(run) || MIXED.test(run)) return true;
  return inMatch(text, span, RESOURCE_ID) || inMatch(text, span, UUID) || inMatch(text, span, ARN);
}
