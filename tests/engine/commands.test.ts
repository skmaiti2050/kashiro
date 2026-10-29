/**
 * Task F20 item 1 (owner decision 2026-10-28: "Protect command-like text"). A runbook's commands were broken by
 * "Tick all" and Apply: "--region" became "–region", the space before a line-continuation "\" was deleted and
 * "sudo" became "Sudo". Formatting, Punctuation, Capitalisation and every other non-spelling rule are never offered
 * on command-like text; spelling flags there are asked on their own cards, never on the simple-fixes card.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { COMMAND_WORDS, findCommandSpans, findCommandSpansInParagraphs, PROSE_COMMAND_WORDS } from '@/engine/commands';
import { WORD_REWRITE_KINDS } from '@/engine/wordFlags';
import type { Paragraph, Span, Tier } from '@/engine/types';
import { AUTO_APPLY_KINDS } from '@/ui/state/settings';
import { PRESETS, type PresetId } from '@/engine/presets';
import { markdownAdapter, plaintextAdapter } from '@/formats/text';
import { runbookParagraphs } from './neverDamageCorpus';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts = (over: Partial<CheckOptions> = {}): CheckOptions => ({
  preset: 'business',
  fallbackVariant: 'Indian',
  language: 'plaintext',
  dictionary: [],
  ...over,
});
const EVERYTHING_AUTO: Partial<Record<string, Tier>> = Object.fromEntries(AUTO_APPLY_KINDS.map((k) => [k, 'safe']));

/** The text each span covers. */
const covered = (text: string, spans: Span[]) => spans.map((s) => text.slice(s.start, s.end));

describe('findCommandSpans: what looks like a command', () => {
  it('names its command words in one tested list, and the ones that are no English word in a second', () => {
    expect([...COMMAND_WORDS].sort()).toEqual(
      [
        'aws', 'cat', 'cd', 'chmod', 'chown', 'curl', 'docker', 'echo', 'export', 'find', 'git', 'grep', 'helm', 'kubectl', 'ls', 'npm', 'npx', 'pip', 'python', 'scp', 'sed', 'ssh', 'sudo', 'systemctl', 'terraform', 'xargs',
        // Task F21 item A: bare command lines with no other sign of a command ("make the the", "go run .").
        'apt', 'apt-get', 'brew', 'cargo', 'cp', 'gh', 'go', 'journalctl', 'kill', 'make', 'mkdir', 'mv', 'node', 'openssl', 'ps', 'rg', 'rm', 'service', 'source', 'su', 'tail', 'tar', 'tee', 'touch', 'unzip', 'wget', 'yarn', 'yum',
      ].sort(),
    );
    expect([...PROSE_COMMAND_WORDS].sort()).toEqual(
      ['apt-get', 'aws', 'chmod', 'chown', 'docker', 'gh', 'git', 'grep', 'journalctl', 'kubectl', 'npm', 'npx', 'openssl', 'scp', 'sed', 'ssh', 'sudo', 'systemctl', 'terraform', 'wget', 'xargs', 'yum'].sort(),
    );
    for (const word of PROSE_COMMAND_WORDS) expect(COMMAND_WORDS.has(word), word).toBe(true);
  });

  it('an option token: --flag, --flag=value or -x, in prose too', () => {
    expect(covered('Use the --dry-run flag first.', findCommandSpans('Use the --dry-run flag first.'))).toEqual(['--dry-run']);
    expect(covered('Pass -v for more detail.', findCommandSpans('Pass -v for more detail.'))).toEqual(['-v']);
    expect(covered('Set --region=ap-south-1 here.', findCommandSpans('Set --region=ap-south-1 here.'))).toEqual(['--region=ap-south-1']);
  });

  it('not a dash in prose, a hyphenated word, a negative number or a range', () => {
    for (const text of ['Check the output -- it should list them.', 'A well-known fact.', 'It was -5 degrees.', 'Pages 10-12 and pre- and post-war.', 'Wait - then go.']) {
      expect(findCommandSpans(text), text).toEqual([]);
    }
  });

  it('a line that ends with a continuation "\\" (the whitespace before it included), and the lines it continues', () => {
    const text = 'Run: aws s3 ls \\\n--recursive \\\n  --human-readable\nThen check it.';
    expect(covered(text, findCommandSpans(text))).toEqual(['Run: aws s3 ls \\\n--recursive \\\n  --human-readable']);
    expect(covered('docker build . \\', findCommandSpans('docker build . \\'))).toEqual(['docker build . \\']);
    expect(covered('a b\t\\\r\nc d\r\ne', findCommandSpans('a b\t\\\r\nc d\r\ne'))).toEqual(['a b\t\\\r\nc d']);
    // A backslash inside a line is a path or an escape, not a continuation; so is one glued to a word.
    expect(findCommandSpans('Open C:\\work \\ now.')).toEqual([]);
    expect(findCommandSpans('Copy it to C:\\temp\\\nthen go.')).toEqual([]);
  });

  it('a line that starts with a command word or a prompt, with its continuation lines', () => {
    const text = 'Stop the service first.\nsudo systemctl stop nginx\n  aws ec2 describe-instances \\\n  --region ap-south-1 \\\n  --output text\nThen wait.';
    // Each command line whole, indentation included; command lines in a row are one block, their line breaks too.
    expect(covered(text, findCommandSpans(text))).toEqual([
      'sudo systemctl stop nginx\n  aws ec2 describe-instances \\\n  --region ap-south-1 \\\n  --output text',
    ]);
    expect(covered('$ docker ps -a', findCommandSpans('$ docker ps -a'))).toEqual(['$ docker ps -a']);
    expect(covered('> kubectl get pods', findCommandSpans('> kubectl get pods'))).toEqual(['> kubectl get pods']);
  });

  it('not a capitalised word, a word inside a line, a quote line or an amount', () => {
    for (const text of ['Find the file and open it.', 'Then run it.', 'We cd into it.', '> This is a quote.', '$ 500 was spent.', 'catalogue entries', 'finder app']) {
      expect(findCommandSpans(text), text).toEqual([]);
    }
  });

  it('inline code in backticks', () => {
    expect(covered('Run `npm --version` now.', findCommandSpans('Run `npm --version` now.'))).toEqual(['`npm --version`']);
  });
});

describe('findCommandSpans: commands by their shape, not a word list (Task F21 item A)', () => {
  it.each([
    // A variable, a loop or test keyword line, a redirect, a pipe.
    'until sudo docker pull ${SRC}; do\n  sleep 5\ndone',
    'for i in 1 2 3; do echo $i; done',
    'if [ -f /etc/x ]; then\n  echo found\nfi',
    'while read line; do echo $line; done < file.txt',
    'node app.js > out.log 2>&1',
    'journalctl -u nginx | tail -n 50',
    'FOO=$(date) && ls',
    // A here-document, its body and its end word.
    'cat <<EOF > words.txt\nthe the\nEOF',
    "tee /etc/app.conf <<'EOF'\nhost = localhost\nlog level = debug\nEOF",
    'cat <<-END\n\tname: my app\n\tEND',
    // Bare command lines: a listed command word starts them.
    'make the the',
    'brew install jq',
    'cargo build',
    'go run .',
    // A comment line above or inside a command block; a make target over its recipe.
    '# Install docker if not present\nsudo apt-get install -y docker.io',
    'build:\n\tgo build -o bin/app ./cmd/app\n\ttest:  lint\n\tgo test ./...',
    // A quoted argument that runs over several lines.
    "aws ec2 describe-instances --query 'Reservations[].Instances[].{\nId:InstanceId; Type:InstanceType;\nState:State.Name}' --output table",
  ])('a command block, whole: %j', (text) => {
    expect(covered(text, findCommandSpans(text))).toEqual([text]);
  });

  it('a list label and a comment line under a command belong to the block', () => {
    const text = 'Steps:\n1. until sudo docker pull ${SRC}; do sleep 5; done\n2. # install docker if not present\n3. gh secret set FOO --body "$X"';
    expect(covered(text, findCommandSpans(text))).toEqual([text.slice('Steps:\n'.length)]);
  });

  it('in a sentence: from a command word (or the shell keyword before it) to the end of its clause', () => {
    const spans = (text: string) => covered(text, findCommandSpans(text));
    expect(spans('Scripts use sudo su ubuntu to switch user.')).toEqual(['sudo su ubuntu to switch user']);
    expect(spans('Switch user: sudo su ubuntu. then run the script.')).toEqual(['sudo su ubuntu']);
    expect(spans('The docker daemon must run. until sudo docker pull ${SRC}; do sleep 5; done')).toEqual(['until sudo docker pull ${SRC}; do sleep 5; done']);
    expect(spans('Step 3: run apt-get update , then reboot.')).toEqual(['apt-get update']);
    expect(spans('Use gh secret set FOO; we need it.')).toEqual(['gh secret set FOO']);
    // After an article the word is a noun, not a command.
    expect(spans('Use the docker CLI. The docker daemon must run.')).toEqual([]);
  });

  it('carries a continuation, an open quote and an indented line into the next paragraph (a .docx line each)', () => {
    const check = (lines: string[], commandLines: number) => {
      const paras = lines.map((text, id) => ({ id, text }));
      const found = findCommandSpansInParagraphs(paras);
      expect(paras.map((p) => covered(p.text, found.get(p.id)!))).toEqual(lines.map((line, i) => (i < commandLines ? [line] : [])));
    };
    check(['aws ec2 describe-instances \\', '  --region ap-south-1 \\', "  --query 'Reservations[].{Id:InstanceId; Type:InstanceType}' \\", '  --output table', 'Then check it.'], 4);
    check(["aws ec2 describe-instances --query 'Reservations[].Instances[].{", 'Id:InstanceId; Type:InstanceType;', "State:State.Name}' --output table", 'Then check it.'], 3);
    check(['until sudo docker pull ${SRC}; do', '  sleep 5', 'done', 'Then continue.'], 3);
    check(['sudo docker run -d \\', '  -p 80:80 \\', '  nginx:latest', 'We are done.'], 3);
  });

  it('a stray apostrophe or an unclosed here-document carries nothing on', () => {
    const paras = [{ id: 0, text: "echo don't stop" }, { id: 1, text: 'We left early; the plan changed.' }, { id: 2, text: 'cat <<EOF > x' }, { id: 3, text: 'The rest is prose.' }];
    const found = findCommandSpansInParagraphs(paras);
    expect(found.get(1)).toEqual([]);
    expect(found.get(3)).toEqual([]);
  });

  it('prose is not a command: semicolons, a Markdown table, a quote line, a comparison, a dash, an English word at a sentence start', () => {
    for (const text of [
      'We met on Monday; the plan changed.',
      'Copy it; then paste it.',
      '| Name | Age |',
      '| a | b | c |',
      '> This is a quote.',
      'If x > y then stop.',
      'Wait - then go.',
      'make sure it works.',
      'Find the cat and echo the call.',
      "Don't stop; it's fine.",
      '- go to the shop',
    ]) {
      expect(findCommandSpans(text), text).toEqual([]);
    }
    // An option in a sentence is its own span only: the prose around it keeps its fixes.
    expect(covered('use the --verbose flag to see more; then retry.', findCommandSpans('use the --verbose flag to see more; then retry.'))).toEqual(['--verbose']);
    expect(covered('the value is $HOME/bin , and ${PATH} too.', findCommandSpans('the value is $HOME/bin , and ${PATH} too.'))).toEqual(['$HOME', '${PATH}']);
  });
});

/** The stress corpus's runbook (commands with --flags, trailing " \", "sudo" at line starts, en-dash bait, prose). */
// Its commands are the corpus's [[traps]], marked by hand rather than found by the engine's own rule.
const SOURCE = runbookParagraphs();
const RUNBOOK: Paragraph[] = SOURCE.map((p, id) => ({ id, text: p.text }));

/** The command text of each runbook paragraph, which no click on the simple-fixes card may change. */
const commandText = (id: number) => covered(SOURCE[id].text, SOURCE[id].traps);
const onCommand = (paraId: number, span: Span) => SOURCE[paraId].traps.some((x) => span.start < x.end && x.start < span.end);

/** Non-spelling flags offered on any card whose span overlaps command text. */
function offeredOnCommands(s: CheckSession): string[] {
  const { top, more } = s.decisions();
  const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
  return s
    .candidates()
    .filter((c) => offered.has(c.id) && !WORD_REWRITE_KINDS.has(c.kind) && onCommand(c.paraId, c.span))
    .map((c) => `¶${c.paraId} ${c.kind} ${JSON.stringify(c.original)} → ${JSON.stringify(c.replacements[0] ?? '')}`);
}

/**
 * Answers every batch card at once (the review's oracle, Task F21): its default ticks, or with `tickAll` every member
 * that has a fix, spelling batches included. Returns how many members it applied.
 */
function applyEveryBatch(s: CheckSession, tickAll: boolean): number {
  const byId = new Map(s.candidates().map((c) => [c.id, c]));
  const { top, more } = s.decisions();
  let applied = 0;
  for (const d of [...top, ...more].filter((x) => x.kind === 'batch')) {
    const unticked = new Set(d.startUnticked ?? []);
    const ids = d.candidateIds.filter((id) => (tickAll ? byId.get(id)!.replacements.length > 0 : !unticked.has(id)));
    if (ids.length === 0) continue;
    s.applyBatch(d.id, ids);
    applied += ids.length;
  }
  return applied;
}

const RUNS = (Object.keys(PRESETS) as PresetId[]).flatMap((preset) =>
  (['default settings', 'every auto-apply kind on'] as const).map((setting) => ({ preset, setting })),
);

describe('commands in a runbook are never formatted, punctuated or capitalised (Task F20 item 1)', () => {
  it.each(RUNS)('$preset preset, $setting: nothing but spelling is offered on command text', async ({ preset, setting }) => {
    const s = await CheckSession.start(RUNBOOK, opts({ preset, tierOverrides: setting === 'default settings' ? undefined : EVERYTHING_AUTO }), { linter });
    expect(offeredOnCommands(s)).toEqual([]);
  });

  it.each(RUNS)('$preset preset, $setting: default ticks, then Tick all, on every batch card leave every command byte-identical', async ({ preset, setting }) => {
    const tierOverrides = setting === 'default settings' ? undefined : EVERYTHING_AUTO;
    for (const tickAll of [false, true]) {
      const s = await CheckSession.start(RUNBOOK, opts({ preset, tierOverrides }), { linter });
      const applied = applyEveryBatch(s, tickAll);
      // Tick all applies the prose fixes, so the test can't pass by the cards being empty.
      if (tickAll) expect(applied).toBeGreaterThan(0);
      for (const p of RUNBOOK) {
        const after = s.outputText(p.id);
        for (const command of commandText(p.id)) expect(after, `${tickAll ? 'Tick all' : 'default ticks'}: ¶${p.id}`).toContain(command);
      }
    }
  });

  it('spelling flags on commands are asked on their own cards, never on the simple-fixes card', async () => {
    const s = await CheckSession.start(RUNBOOK, opts({ tierOverrides: EVERYTHING_AUTO }), { linter });
    const card = [...s.decisions().top, ...s.decisions().more].find((d) => d.id === SIMPLE_FIXES_ID);
    const onCard = new Set(card?.candidateIds ?? []);
    const onCommands = s.candidates().filter((c) => onCommand(c.paraId, c.span));
    // "nginx" was the word here until it joined the technical words (Task F21 item F).
    const jq = onCommands.find((c) => c.original === 'jq');
    expect(jq && s.tier(jq.id)).toBe('review');
    expect(onCommands.filter((c) => onCard.has(c.id)).map((c) => c.original)).toEqual([]);
  });

  it('prose fixes around the commands are still offered', async () => {
    const s = await CheckSession.start(RUNBOOK, opts(), { linter });
    const { top, more } = s.decisions();
    const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
    const fixes = s.candidates().filter((c) => offered.has(c.id)).map((c) => `¶${c.paraId} ${c.original} → ${c.replacements[0] ?? ''}`);
    expect(fixes).toEqual(expect.arrayContaining(['¶0 then → Then', '¶9 -- → –', '¶9   → ', '¶10 -- → –', '¶10 we → We']));
  });

  it('spelling on a command never joins a batch card, and a fix that only changes its case is not offered (Task F21, review M-17)', async () => {
    // The owner's repro: "docker → Docker (2 places)" was a Spelling batch whose Tick all edited both commands.
    const lines = ['until sudo docker pull ${SRC}; do', '# Install docker if not present', 'gh secret set FOO --body "$X"', 'gh auth login'];
    const paras = lines.map((text, id) => ({ id, text }));
    for (const tierOverrides of [undefined, EVERYTHING_AUTO]) {
      const s = await CheckSession.start(paras, opts({ tierOverrides }), { linter });
      const byId = new Map(s.candidates().map((c) => [c.id, c]));
      const { top, more } = s.decisions();
      const batched = [...top, ...more].filter((d) => d.kind === 'batch').flatMap((d) => d.candidateIds.map((id) => `${d.label}: ${byId.get(id)!.original}`));
      expect(batched).toEqual([]);
      const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
      const caseOnly = s.candidates().filter((c) => offered.has(c.id) && c.replacements.some((r) => r !== c.original && r.toLowerCase() === c.original.toLowerCase()));
      expect(caseOnly.map((c) => `${c.original} → ${c.replacements.join(' / ')}`)).toEqual([]);
      applyEveryBatch(s, true);
      expect(paras.map((p) => s.outputText(p.id))).toEqual(lines);
    }
  });

  it('prose keeps its fixes: semicolons, a quote line, a comparison, an option in a sentence, a Markdown table (Task F21)', async () => {
    const offeredFixes = async (file: string, adapter = plaintextAdapter) => {
      const { paras } = await adapter.read(new TextEncoder().encode(file));
      const s = await CheckSession.start(paras, opts({ language: adapter.language }), { linter });
      const { top, more } = s.decisions();
      const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
      return s.candidates().filter((c) => offered.has(c.id)).map((c) => `${c.original} → ${c.replacements[0] ?? ''}`);
    };
    const prose = ['use the --verbose flag to see more; then retry.', 'We met on Monday; the the plan changed.', '> This is is a quote line.', 'If x > y then we we stop.'];
    expect(await offeredFixes(prose.join('\n\n'))).toEqual(expect.arrayContaining(['use → Use', 'the the → the', 'is is → is', 'we we → we']));
    expect(await offeredFixes('| Name | Note |\n|---|---|\n| Rao | it was was fine |\n', markdownAdapter)).toEqual(expect.arrayContaining(['was was → was']));
  });

  it('every kind but spelling is withheld on a command: grammar ("Add a determiner": "apt-get-the update") included', async () => {
    const lines = ['sudo apt-get update', 'sudo apt-get install nginx', 'sudo apt-get update && sudo apt-get upgrade -y', 'git commit -m fix', 'npm install react', 'cat file | grep error'];
    const paras = lines.map((text, id) => ({ id, text }));
    for (const tierOverrides of [undefined, EVERYTHING_AUTO]) {
      const s = await CheckSession.start(paras, opts({ preset: 'academic', tierOverrides }), { linter });
      const { top, more } = s.decisions();
      const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
      const notSpelling = s.candidates().filter((c) => (offered.has(c.id) || s.tier(c.id) === 'safe') && !WORD_REWRITE_KINDS.has(c.kind));
      expect(notSpelling.map((c) => `${lines[c.paraId]}: ${c.kind} ${c.original} → ${c.replacements[0] ?? ''}`)).toEqual([]);
    }
  });

  it('an AI rewrite of a command is withheld too', async () => {
    const text = 'sudo apt-get update';
    const s = await CheckSession.start([{ id: 0, text }], opts(), { linter });
    s.addRewrite(0, { start: 0, end: text.length }, 'sudo apt-get the update', text);
    const { top, more } = s.decisions();
    const ai = s.candidates().filter((c) => c.source === 'llm');
    expect(ai.length).toBe(1);
    expect(ai.map((c) => s.tier(c.id))).toEqual(['hidden']);
    expect([...top, ...more].flatMap((d) => d.candidateIds)).not.toContain(ai[0].id);
  });

  it('Markdown code (a fenced block, inline code) gets no flag but spelling', async () => {
    const file = 'Run `npm  --version` first.\n\n```bash\nSudo systemctl stop nginx  ;  aws s3 ls --region ap-south-1 \\\n  --output text\n```\n\nThen we wait.\n';
    const { paras } = await markdownAdapter.read(new TextEncoder().encode(file));
    const s = await CheckSession.start(paras, opts({ language: 'markdown', tierOverrides: EVERYTHING_AUTO }), { linter });
    const { top, more } = s.decisions();
    const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
    const text = (paraId: number) => paras.find((p) => p.id === paraId)!.text;
    const inCode = s
      .candidates()
      .filter((c) => !WORD_REWRITE_KINDS.has(c.kind) && (offered.has(c.id) || s.tier(c.id) === 'safe'))
      .filter((c) => text(c.paraId).startsWith('```') || text(c.paraId).slice(0, c.span.end).split('`').length % 2 === 0)
      .map((c) => `${c.kind} ${JSON.stringify(c.original)}`);
    expect(inCode).toEqual([]);
    expect(s.outputText(paras[0].id)).toBe('Run `npm  --version` first.');
  });

  it('a run of spaces before a trailing "\\" is never collapsed without a click', async () => {
    const s = await CheckSession.start([{ id: 0, text: 'The list goes  \\\non here.' }, { id: 1, text: 'We went  home.' }], opts(), { linter });
    expect(s.outputText(0)).toBe('The list goes  \\\non here.');
    expect(s.outputText(1)).toBe('We went home.');
  });
});
