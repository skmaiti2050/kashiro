/**
 * Task F21c (F21 adversarial review M-25). Loading short command words as known words everywhere hid real prose
 * typos: "aws" for "was", "su" for "us", "arn" for "ran", "cp" for "cap". The command and cloud words of three
 * letters or fewer are now known only inside surely-command text (Task F21d, review M-32: maybe text was prose like
 * "We met on time; he arn to the bus."). Elsewhere Harper flags them as before, and they never get an upper-case
 * offer there ("rds" → "RDS", "ps" → "PS").
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { SHORT_TECHNICAL_WORDS, TECHNICAL_WORDS } from '@/engine/wordlists/technical';
import { WORD_REWRITE_KINDS } from '@/engine/wordFlags';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts = (over: Partial<CheckOptions> = {}): CheckOptions => ({ preset: 'business', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [], ...over });

/** Every spelling fix offered on a card, as "original → replacement", and the originals flagged at all. */
async function spellingOf(lines: string[]) {
  const paras = lines.map((text, id) => ({ id, text }));
  const s = await CheckSession.start(paras, opts(), { linter });
  const { top, more } = s.decisions();
  const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
  const flags = s.candidates().filter((c) => offered.has(c.id) && WORD_REWRITE_KINDS.has(c.kind));
  return { flagged: flags.map((c) => c.original), fixes: flags.flatMap((c) => c.replacements.map((r) => `${c.original} → ${r}`)) };
}

describe('short technical words (Task F21c, review M-25)', () => {
  it('are a separate list of words of three letters or fewer; the global list keeps only longer ones', () => {
    expect([...SHORT_TECHNICAL_WORDS].sort()).toEqual(['ami', 'arn', 'aws', 'cp', 'ecr', 'gh', 'mv', 'npx', 'ps', 'rds', 'rg', 'scp', 'ssm', 'su', 'vpc']);
    for (const w of SHORT_TECHNICAL_WORDS) expect(w.length, w).toBeLessThanOrEqual(3);
    for (const w of TECHNICAL_WORDS) expect(w.length, w).toBeGreaterThan(3);
  });

  it('in prose, Harper flags them as before', async () => {
    const { flagged } = await spellingOf(['It aws a great day and the weather aws fine.', 'Tell su about it, and give su the keys.', 'He arn to the shop.', 'Pour a cp of tea.']);
    expect(flagged).toEqual(['aws', 'aws', 'su', 'su', 'arn', 'cp']);
  });

  it('in prose, they never get an upper-case offer', async () => {
    const { fixes } = await spellingOf(['Three rds of the race were done.', "I'll ps you the notes.", 'The ssm lady came.']);
    expect(fixes.filter((f) => /^(\w+) → (\w+)$/.test(f) && f.split(' → ')[0].toLowerCase() === f.split(' → ')[1].toLowerCase())).toEqual([]);
  });

  it('in command text they are known: no spelling card', async () => {
    const { flagged } = await spellingOf([
      'sudo su ubuntu',
      'gh auth login',
      'aws s3 ls --recursive',
      'ps aux | grep node',
      'cp a.txt b.txt',
      'rg -n foo src/',
      'Scripts use sudo su ubuntu to switch user.',
      'aws ec2 describe-vpcs --filters Name=tag:Env,Values=prod # vpc ami arn ssm rds ecr',
    ]);
    expect(flagged.filter((w) => SHORT_TECHNICAL_WORDS.includes(w))).toEqual([]);
  });

  it('in text that is only maybe a command, Harper flags them as in prose (Task F21d, review M-32)', async () => {
    const { flagged } = await spellingOf(['We met on time; he arn to the bus.', 'Make sure it aws ready before noon.', 'Send notes.txt to su before noon.']);
    expect(flagged.filter((w) => SHORT_TECHNICAL_WORDS.includes(w))).toEqual(['arn', 'aws', 'su']);
  });
});
