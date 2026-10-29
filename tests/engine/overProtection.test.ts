/**
 * Task F21c (F21 adversarial review M-20 to M-23): prose that only looks a little like a command lost every fix.
 * "Surely a command" keeps F21's protection; "maybe a command" offers every fix, with nothing ticked.
 *
 * The over-protection judge: for each prose input, every fix the session offers with command detection switched
 * off must still be offered with it on (text in `commands`, a real command, is left out of the comparison).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { markdownAdapter, plaintextAdapter } from '@/formats/text';
import { AUTO_APPLY_KINDS } from '@/ui/state/settings';
import type { Paragraph, Span, Tier } from '@/engine/types';
import * as technical from '@/engine/wordlists/technical';

/** The short command words (Task F21c); empty before the list existed, so the judge can run on the old engine. */
const SHORT_TECHNICAL_WORDS: readonly string[] = (technical as { SHORT_TECHNICAL_WORDS?: readonly string[] }).SHORT_TECHNICAL_WORDS ?? [];

/** Switches command detection off for the judge's baseline run. */
const detection = vi.hoisted(() => ({ on: true }));
vi.mock('@/engine/commands', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = await importOriginal<any>();
  const none = (paras: readonly Paragraph[]) => new Map<number, Span[]>(paras.map((p) => [p.id, []]));
  return {
    ...real,
    findCommandSpansInParagraphs: (paras: readonly Paragraph[]) => (detection.on ? real.findCommandSpansInParagraphs(paras) : none(paras)),
    findCommandText: (paras: readonly Paragraph[]) => (detection.on ? real.findCommandText(paras) : { surely: none(paras), maybe: none(paras) }),
  };
});

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const EVERYTHING_AUTO: Partial<Record<string, Tier>> = Object.fromEntries(AUTO_APPLY_KINDS.map((k) => [k, 'safe']));
const opts = (language: 'plaintext' | 'markdown', over: Partial<CheckOptions> = {}): CheckOptions => ({
  preset: 'business',
  fallbackVariant: 'Indian',
  language,
  dictionary: [],
  ...over,
});

interface Offered {
  /** "original → replacement" at "paragraph:start". */
  key: string;
  fix: string;
  ticked: boolean;
}

/** Every fix offered on a card (each replacement), and whether it starts ticked on a batch card. */
async function offeredFixes(input: string, markdown: boolean, commands: readonly string[] = [], tierOverrides?: CheckOptions['tierOverrides']): Promise<Offered[]> {
  const adapter = markdown ? markdownAdapter : plaintextAdapter;
  const { paras } = await adapter.read(new TextEncoder().encode(input));
  const s = await CheckSession.start(paras, opts(adapter.language, { tierOverrides }), { linter });
  const { top, more } = s.decisions();
  const ticked = new Set(
    [...top, ...more].filter((d) => d.kind === 'batch').flatMap((d) => d.candidateIds.filter((id) => !(d.startUnticked ?? []).includes(id))),
  );
  const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
  const onCommand = (paraId: number, span: Span) => {
    const text = paras.find((p) => p.id === paraId)!.text;
    return commands.some((cmd) => {
      for (let at = text.indexOf(cmd); at >= 0; at = text.indexOf(cmd, at + 1)) if (span.start < at + cmd.length && at < span.end) return true;
      return false;
    });
  };
  return s
    .candidates()
    .filter((c) => offered.has(c.id) && !onCommand(c.paraId, c.span))
    .flatMap((c) => c.replacements.map((r) => ({ key: `${c.paraId}:${c.span.start}:${c.original} → ${r}`, fix: `${c.original} → ${r}`, ticked: ticked.has(c.id) })));
}

/** The fixes offered without command detection that are not offered with it. */
async function lostFixes(input: string, markdown: boolean, commands: readonly string[] = []): Promise<string[]> {
  detection.on = false;
  const without = await offeredFixes(input, markdown, commands);
  detection.on = true;
  const withDetection = new Set((await offeredFixes(input, markdown, commands)).map((o) => o.key));
  // A short command word ("ps", "aws") is known inside text that may be a command, by design (review M-25).
  const isShortCommandWord = (fix: string) => SHORT_TECHNICAL_WORDS.includes(fix.split(' → ')[0]);
  return without.filter((o) => !withDetection.has(o.key) && !isShortCommandWord(o.fix)).map((o) => o.fix);
}

interface Prose {
  input: string;
  markdown?: boolean;
  /** Real command text in the input: fixes on it may be withheld. */
  commands?: string[];
}

/** Prose in the shapes of review M-20 to M-23 (and their neighbours), 50 inputs. */
const PROSE: readonly Prose[] = [
  // M-20: a lowercase line that starts with an English word on the command list.
  { input: 'ps i love you and and i miss you' },
  { input: 'Dear Asha,\n\nSee you soon.\n\nps i will call you tomorrow' },
  { input: 'cat sat on the the mat' },
  { input: 'make sure the the oven is hot' },
  { input: 'find the the keys before you leave' },
  { input: 'tail of the the dog was was long' },
  { input: 'go tell it on the the mountain\nover the hills and everywhere' },
  { input: 'touch me in the the morning\nthen just walk away' },
  { input: 'kill the the lights when you leave' },
  { input: 'source of the the river is is far' },
  { input: 'service was slow and and the food cold' },
  { input: 'echo of the the hills came back' },
  // M-21: email and Markdown quote lines.
  { input: '> i think the the plan is fine' },
  { input: 'On Monday Rahul wrote:\n> We met on Monday and\n> the the plan changed, i think.\n\nThanks, i agree.' },
  { input: '> the the plan changed, i think.', markdown: true },
  { input: '> we will meet at at noon' },
  // M-22: a dash glued to a word, "use -v", a weak sign on a line that doesn't read as a sentence, command words as nouns.
  { input: 'This is a well -known fact and and everyone knows it.' },
  { input: 'I was tired -but i was happy and and relaxed.' },
  { input: 'e.g. use -v to see the the output.' },
  { input: 'For more detail, use -v to see the the output.' },
  { input: 'rahul: i went home -it was late and and dark' },
  { input: 'home | about | the the contact page' },
  { input: 'salt && pepper and and oil' },
  { input: 'please contact priya <priya.k@corp.in> for the the details' },
  { input: 'buy $AAPL and and hold it' },
  { input: 'I would buy $AAPL and and hold it.' },
  { input: '<<Back to the the home page' },
  { input: 'if you can come; then call me and and we will go' },
  { input: 'for those in need; do what you can and and more' },
  { input: '- done\n  the the next item is is pending' },
  { input: 'I use git for work and and fun.' },
  { input: 'We moved to aws last year and and saved money.' },
  { input: 'That cake was yum and and sweet.' },
  { input: 'Use node -v , then check the the output' },
  { input: 'open notes.txt < 5 minutes and and close it' },
  // M-23: indented prose under a command, across blank lines and in list items; a "#" heading above a command.
  { input: 'sudo systemctl restart nginx\n    This restarts the the server, i think.', commands: ['sudo systemctl restart nginx'] },
  { input: 'sudo systemctl restart nginx\n\n    This restarts the the server, i think.', commands: ['sudo systemctl restart nginx'] },
  {
    input: 'Step 1\nsudo systemctl restart nginx\n  This restarts the the server.\n  It takes a minute and and then it is up.\n\nStep 2\n  Check the the logs.',
    commands: ['sudo systemctl restart nginx'],
  },
  { input: 'sudo systemctl restart nginx\n\n\tThis restarts the the server.\n\n\tIt takes a minute and and then it is up.', commands: ['sudo systemctl restart nginx'] },
  { input: '\tShe typed it in: export PATH=$PATH:/opt/bin\n\n\tThen she waited and and waited. i was there.', commands: ['export PATH=$PATH:/opt/bin'] },
  { input: '1. Restart it:\n\n   sudo systemctl restart nginx\n\n   This restarts the the server.\n', markdown: true, commands: ['sudo systemctl restart nginx'] },
  { input: '1. Restart it:\n\n   ```\n   sudo systemctl restart nginx\n   ```\n\n   This restarts the the server.\n', markdown: true, commands: ['sudo systemctl restart nginx'] },
  { input: '- Run `sudo systemctl restart nginx`.\n\n  This restarts the the server.\n', markdown: true, commands: ['`sudo systemctl restart nginx`'] },
  { input: '# Install the the tools\nsudo apt-get install -y curl', commands: ['sudo apt-get install -y curl'] },
  { input: '# Notes on the the setup\n\nsudo apt-get install -y curl', commands: ['sudo apt-get install -y curl'] },
  { input: 'sudo apt update\n# this this step is optional', commands: ['sudo apt update'] },
  { input: 'Run the following:\n\nsudo apt update\nThe the update takes a minute.', commands: ['sudo apt update'] },
  { input: 'INT. KITCHEN - NIGHT\n\nRAHUL\n    (whispering)\n    i think the the door is open' },
  { input: 'Things to pack:\n- go to the the shop\n- touch up the the paint' },
  { input: 'meeting w/ rahul -> discuss the the budget' },
];

describe('the over-protection judge: prose keeps every fix it gets without command detection (Task F21c)', () => {
  it('has at least 40 inputs', () => {
    expect(PROSE.length).toBeGreaterThanOrEqual(40);
  });

  it('loses no fix on any input', async () => {
    const lost: string[] = [];
    for (const p of PROSE) {
      const fixes = await lostFixes(p.input, p.markdown ?? false, p.commands);
      if (fixes.length) lost.push(`${JSON.stringify(p.input)}: ${fixes.join(', ')}`);
    }
    expect(lost).toEqual([]);
  }, 120_000);
});

interface Repro {
  input: string;
  markdown?: boolean;
  /** Fixes that must be offered, as "original → replacement". */
  fixes: string[];
  /** The input has a weak command sign: no offered fix may start ticked. */
  weakSign?: boolean;
}

/** The review's repros, each with the fix its control sentence gets. */
const REPROS: readonly Repro[] = [
  // M-20.
  { input: 'ps i love you and and i miss you', fixes: ['i → I', 'and and → and'], weakSign: true },
  { input: 'Dear Asha,\n\nSee you soon.\n\nps i will call you tomorrow', fixes: ['i → I'], weakSign: true },
  { input: 'cat sat on the the mat', fixes: ['the the → the'], weakSign: true },
  { input: 'make sure the the oven is hot', fixes: ['the the → the'], weakSign: true },
  { input: 'find the the keys before you leave', fixes: ['the the → the'], weakSign: true },
  { input: 'tail of the the dog was was long', fixes: ['the the → the'], weakSign: true },
  { input: 'go tell it on the the mountain\nover the hills and everywhere', fixes: ['the the → the'], weakSign: true },
  { input: 'touch me in the the morning\nthen just walk away', fixes: ['the the → the'], weakSign: true },
  // M-21.
  { input: '> i think the the plan is fine', fixes: ['i → I'], weakSign: true },
  { input: 'On Monday Rahul wrote:\n> We met on Monday and\n> the the plan changed, i think.\n\nThanks, i agree.', fixes: ['the the → the', 'i → I'], weakSign: true },
  { input: '> the the plan changed, i think.', markdown: true, fixes: ['the the → the', 'i → I'], weakSign: true },
  // M-22.
  { input: 'This is a well -known fact and and everyone knows it.', fixes: ['and and → and'], weakSign: true },
  { input: 'I was tired -but i was happy and and relaxed.', fixes: ['i → I', 'and and → and'], weakSign: true },
  // (Harper finds no doubling in "use -v to see the the output", with or without detection: the judge covers it.)
  { input: 'rahul: i went home -it was late and and dark', fixes: ['i → I', 'and and → and'], weakSign: true },
  { input: 'home | about | the the contact page', fixes: ['the the → the'], weakSign: true },
  { input: 'salt && pepper and and oil', fixes: ['and and → and'], weakSign: true },
  { input: 'please contact priya <priya.k@corp.in> for the the details', fixes: ['the the → the'], weakSign: true },
  { input: 'buy $AAPL and and hold it', fixes: ['and and → and'], weakSign: true },
  { input: '<<Back to the the home page', fixes: ['the the → the'], weakSign: true },
  { input: 'if you can come; then call me and and we will go', fixes: ['and and → and'], weakSign: true },
  { input: 'for those in need; do what you can and and more', fixes: ['and and → and'], weakSign: true },
  { input: '- done\n  the the next item is is pending', fixes: ['the the → the', 'is is → is'] },
  { input: 'I use git for work and and fun.', fixes: ['and and → and'] },
  { input: 'We moved to aws last year and and saved money.', fixes: ['and and → and'] },
  { input: 'That cake was yum and and sweet.', fixes: ['and and → and'] },
  // M-23.
  { input: 'sudo systemctl restart nginx\n\n    This restarts the the server, i think.', fixes: ['the the → the', 'i → I'] },
  { input: 'Step 1\nsudo systemctl restart nginx\n  This restarts the the server.\n  It takes a minute and and then it is up.', fixes: ['the the → the', 'and and → and'] },
  { input: 'sudo systemctl restart nginx\n\n\tThis restarts the the server.\n\n\tIt takes a minute and and then it is up.', fixes: ['the the → the', 'and and → and'] },
  { input: '1. Restart it:\n\n   sudo systemctl restart nginx\n\n   This restarts the the server.\n', markdown: true, fixes: ['the the → the'] },
  { input: '1. Restart it:\n\n   ```\n   sudo systemctl restart nginx\n   ```\n\n   This restarts the the server.\n', markdown: true, fixes: ['the the → the'] },
  { input: '# Install the the tools\nsudo apt-get install -y curl', fixes: ['the the → the'], weakSign: true },
  { input: '# Notes on the the setup\n\nsudo apt-get install -y curl', fixes: ['the the → the'] },
  { input: 'sudo apt update\n# this this step is optional', fixes: ['this this → this'], weakSign: true },
];

describe('the review\'s over-protection repros get their fixes back, unticked where a weak sign is present (Task F21c)', () => {
  it.each(REPROS)('$input', async ({ input, markdown, fixes, weakSign }) => {
    for (const tierOverrides of [undefined, EVERYTHING_AUTO]) {
      const offered = await offeredFixes(input, markdown ?? false, [], tierOverrides);
      expect(offered.map((o) => o.fix)).toEqual(expect.arrayContaining(fixes));
      if (weakSign) expect(offered.filter((o) => o.ticked).map((o) => o.fix)).toEqual([]);
    }
  });
});
