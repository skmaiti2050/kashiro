import type { Candidate, Span } from './types';
import { overlapsLocked } from './factLock';
import { WORD_REWRITE_KINDS } from './wordFlags';
import { COMMAND_WORDS, ENGLISH_COMMAND_WORDS } from './commandShapes';
import { SHORT_TECHNICAL_WORDS, TECHNICAL_WORDS } from './wordlists/technical';

const SHORT_WORDS: ReadonlySet<string> = new Set(SHORT_TECHNICAL_WORDS);
/** Command and cloud words whose capital names another thing, or nothing ("docker" → "Docker", "git" → "Git"). */
const COMMAND_NAMES: ReadonlySet<string> = new Set([
  ...[...COMMAND_WORDS].filter((w) => !ENGLISH_COMMAND_WORDS.has(w)),
  ...TECHNICAL_WORDS,
  ...SHORT_TECHNICAL_WORDS,
]);

/** `c` without its fixes that only change the case of its text; null when nothing is left of a non-spelling flag. */
function withoutCaseOnlyFixes(c: Candidate): Candidate | null {
  const original = c.original.toLowerCase();
  const kept = c.replacements.filter((r) => r.toLowerCase() !== original);
  if (kept.length === c.replacements.length) return c;
  if (kept.length === 0 && !WORD_REWRITE_KINDS.has(c.kind)) return null;
  return { ...c, replacements: kept, linterReplacements: c.linterReplacements ?? c.replacements };
}

/**
 * A flag on a command or cloud word, or null when it is dropped (Task F21c):
 * - a short one ("su", "aws", "rds"; SHORT_TECHNICAL_WORDS) is a known word in surely-command text, so its spelling
 *   flag there goes; in maybe text and prose it stays flagged ("We met on time; he arn to the bus", review M-32),
 *   but never with a capital ("rds" → "RDS", review M-25);
 * - in text that may be a command, no capital is offered for a command name ("# Install docker if not present":
 *   "docker" → "Docker" renames the command; the owner's repro, F21 review M-17). An English command word keeps its
 *   capital ("make sure" → "Make sure").
 */
export function withTechnicalWordRules(c: Candidate, surely: Span[] | undefined, maybe: Span[] | undefined): Candidate | null {
  const word = c.original.toLowerCase();
  if (!COMMAND_NAMES.has(word)) return c;
  if (SHORT_WORDS.has(word) && overlapsLocked(c, surely) && WORD_REWRITE_KINDS.has(c.kind)) return null;
  return SHORT_WORDS.has(word) || overlapsLocked(c, maybe) ? withoutCaseOnlyFixes(c) : c;
}
