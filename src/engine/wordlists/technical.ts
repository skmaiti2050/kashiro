/**
 * Command and cloud words that Harper flags as misspellings ("su" → "so", "gh" → "go", "vpc" → "vac"), so a runbook
 * gets no spelling card on them (Task F21 item F, owner). Always loaded, like TECH_WORDS; lowercase, sorted, at most
 * 200 (tested), and each one Harper flags without it (tested). Left out because Harper doesn't flag them as
 * misspellings: "apt-get", "make", "go", "node", "tee", "tar", "brew", "cargo", "yarn", ... (and "stdin", "stdout",
 * "stderr", which it flags only as Style); "json", "yaml" and "npm" are in TECH_WORDS.
 */
export const TECHNICAL_WORDS: readonly string[] = [
  'ami',
  'arn',
  'aws',
  'awscli',
  'chmod',
  'chown',
  'cp',
  'docker',
  'ecr',
  'gh',
  'journalctl',
  'kubectl',
  'mkdir',
  'mv',
  'nginx',
  'npx',
  'nslookup',
  'openssl',
  'ps',
  'rds',
  'rg',
  'scp',
  'ssm',
  'su',
  'sudo',
  'systemctl',
  'ubuntu',
  'vpc',
  'wget',
  'xargs',
];
