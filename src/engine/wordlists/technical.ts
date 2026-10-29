/**
 * Command and cloud words that Harper flags as misspellings ("su" → "so", "gh" → "go", "vpc" → "vac"), so a runbook
 * gets no spelling card on them (Task F21 item F, owner). Lowercase, sorted, at most 200 (tested), and each one Harper
 * flags without it (tested). Left out because Harper doesn't flag them as misspellings: "apt-get", "make", "go",
 * "node", "tee", "tar", "brew", "cargo", "yarn", ... (and "stdin", "stdout", "stderr", which it flags only as Style);
 * "json", "yaml" and "npm" are in TECH_WORDS.
 */

/** The words longer than three letters: always loaded, like TECH_WORDS. */
export const TECHNICAL_WORDS: readonly string[] = [
  'awscli',
  'chmod',
  'chown',
  'docker',
  'journalctl',
  'kubectl',
  'mkdir',
  'nginx',
  'nslookup',
  'openssl',
  'sudo',
  'systemctl',
  'ubuntu',
  'wget',
  'xargs',
];

/**
 * The words of three letters or fewer: known only inside command text, surely or maybe a command. In prose they are
 * typos as often as not ("aws" for "was", "su" for "us", "arn" for "ran"; Task F21c, review M-25).
 */
export const SHORT_TECHNICAL_WORDS: readonly string[] = ['ami', 'arn', 'aws', 'cp', 'ecr', 'gh', 'mv', 'npx', 'ps', 'rds', 'rg', 'scp', 'ssm', 'su', 'vpc'];

/** SHORT_TECHNICAL_WORDS as a set, for lookups. */
export const SHORT_TECHNICAL_WORD_SET: ReadonlySet<string> = new Set(SHORT_TECHNICAL_WORDS);
