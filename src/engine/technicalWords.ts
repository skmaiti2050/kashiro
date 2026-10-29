import type { Candidate, Span } from './types';
import { overlapsLocked } from './factLock';
import { isCaseOnly, withFixesKept, WORD_REWRITE_KINDS } from './wordFlags';
import { NON_ENGLISH_COMMAND_WORDS } from './commandShapes';
import { SHORT_TECHNICAL_WORD_SET, SHORT_TECHNICAL_WORDS, TECHNICAL_WORDS } from './wordlists/technical';

/** Command and cloud words whose capital names another thing, or nothing ("docker" → "Docker", "git" → "Git"). */
const COMMAND_NAMES: ReadonlySet<string> = new Set([...NON_ENGLISH_COMMAND_WORDS, ...TECHNICAL_WORDS, ...SHORT_TECHNICAL_WORDS]);

/** `c` without its fixes that only change the case of its text; null when nothing is left of a non-spelling flag. */
function withoutCaseOnlyFixes(c: Candidate): Candidate | null {
  const kept = withFixesKept(c, (r) => !isCaseOnly(c, r));
  if (kept !== c && kept.replacements.length === 0 && !WORD_REWRITE_KINDS.has(c.kind)) return null;
  return kept;
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
  if (SHORT_TECHNICAL_WORD_SET.has(word) && overlapsLocked(c, surely) && WORD_REWRITE_KINDS.has(c.kind)) return null;
  return SHORT_TECHNICAL_WORD_SET.has(word) || overlapsLocked(c, maybe) ? withoutCaseOnlyFixes(c) : c;
}
