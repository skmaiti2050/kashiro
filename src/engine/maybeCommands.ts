import type { Paragraph, Span } from './types';
import {
  bodyOf,
  COMMAND_WORDS,
  COMMENT_LINE,
  FILE_NAME,
  HEREDOC,
  OPTION,
  PATH,
  REDIRECT,
  sentencesHolding,
  SHELL_KEYWORD_LINE,
  VARIABLE,
} from './commandShapes';

/**
 * Maybe a command (Task F21c, owner: ambiguous goes to review). Shape detection with one yes/no answer traded leaks
 * (a doubling in a missed command started ticked, F21 review I-2) against over-protection (prose lost every fix,
 * M-20 to M-23). Text with a weak sign of a command keeps every card, but no fix there starts ticked and none is
 * made without a click (M-24: spaces in ini and .env lines). A sign marks the sentence it is in, within its line.
 */

/** One line of the paragraphs being scanned; `blank` marks the blank line a file has before a paragraph. */
export interface ScannedLine {
  paraId: number;
  start: number;
  line: string;
  blank: boolean;
}

/** A word that may start a command, in any case: "Echo", "Make", "Python3". */
const FIRST_WORD_ANY_CASE = /^([A-Za-z][A-Za-z0-9-]*)(?=[ \t]|$)/;
/** A Python version as a command: "python3", "python3.11". */
const PYTHON_VERSION = /^python\d+(?:\.\d+)?$/;
/** A quote line ("> i think so") or a Windows prompt ("C:\>", "PS C:\Users\asha>", "PS>") at a line start. */
const QUOTE_OR_WINDOWS_PROMPT = /^[ \t]*(?:>[ \t]|PS(?:[ \t][^>\n]*)?>|[A-Za-z]:\\[^>\n]*>)/;
/** A Dockerfile instruction first on a line, in capitals: "RUN make build", "COPY . /app", "FROM node:20". */
const DOCKERFILE_INSTRUCTION = /^(?:RUN|COPY|FROM)[ \t]/;
/** A PowerShell cmdlet: an approved verb, "-" and a capitalised noun ("Get-ChildItem", "Set-Location"; not "Coca-Cola"). */
const CMDLET =
  /(?<![\p{L}\p{N}_-])(?:Get|Set|New|Remove|Add|Clear|Copy|Move|Rename|Start|Stop|Restart|Invoke|Test|Import|Export|Install|Uninstall|Update|Enable|Disable|Select|Where|ForEach|Write|Read|Out|Format|ConvertTo|ConvertFrom|Measure|Sort|Group|Join|Split|Resolve|Register|Wait|Push|Pop|Enter|Exit|Find|Save|Show|Connect|Expand|Compress|Mount|Compare)-[A-Z][A-Za-z]+/gu;
/** A crontab schedule: five time fields ("30 1 * * *", "*\/5 * * * *") or "@reboot", then the command. */
const CRONTAB = /^[ \t]*(?:@(?:reboot|yearly|annually|monthly|weekly|daily|hourly)|[\d*/,-]+(?:[ \t]+[\d*/,-]+){4})[ \t]/;
/** "|", "&&", "||" or ";" between two lowercase words: "home | about", "salt && pepper", "cd /app; make". */
const LOWERCASE_OPERATOR = /(?<!\p{L})\p{Ll}+[ \t]*(?:\|\|?|&&|;)[ \t]*\p{Ll}/gu;
/** A config line: "name = db", "NODE_ENV=production", "export X=1", "command: echo", "- name: web", "[database]". */
const CONFIG_LINE = /^[ \t]*(?:(?:export[ \t]+)?[A-Za-z_][\w.-]*[ \t]*=[ \t]*\S|(?:-[ \t]+)?[a-z_][\w.-]*:(?:[ \t]+\S|[ \t]*$)|\[[\w .-]+\][ \t]*$)/;
/** An environment variable set in a sentence: "NAMES=a". */
const ENV_ASSIGNMENT = /(?<![\w-])[A-Z][A-Z0-9_]*=\S/g;
/**
 * A SQL statement's first word, in any case (Word capitalises the first letter, review I-3): "select *",
 * "Update users", "INSERT INTO", "delete from".
 */
const SQL_START = /^(?:select|update|insert[ \t]+into|delete[ \t]+from)\b/i;
/** A second SQL keyword, so "update me when you can" is no statement. */
const SQL_KEYWORD = /\b(?:from|set|into|where|values)\b/i;
/** Lines a lowercase SQL statement may run on for before its ";". */
const SQL_REACH = 10;

/** Positions in `line` of every match of a global pattern. */
const positionsOf = (line: string, re: RegExp) => [...line.matchAll(re)].map((m) => m.index!);

/**
 * Where a weak sign is in `line` (not a surely-command line), or [] when it has none. A command word counts after a
 * list label too ("- make the the build", review I-3).
 */
function weakSigns(line: string): number[] {
  const at: number[] = [];
  const body = bodyOf(line);
  const word = FIRST_WORD_ANY_CASE.exec(body)?.[1].toLowerCase();
  if (word !== undefined && (COMMAND_WORDS.has(word) || PYTHON_VERSION.test(word))) at.push(line.length - body.length);
  if (QUOTE_OR_WINDOWS_PROMPT.test(line) || CRONTAB.test(line) || CONFIG_LINE.test(line) || SHELL_KEYWORD_LINE.test(body)) at.push(0);
  if (DOCKERFILE_INSTRUCTION.test(body)) at.push(line.length - body.length);
  for (const re of [OPTION, VARIABLE, PATH, FILE_NAME, LOWERCASE_OPERATOR, ENV_ASSIGNMENT, CMDLET]) at.push(...positionsOf(line, re));
  for (const re of [REDIRECT, HEREDOC]) {
    const i = line.search(re);
    if (i >= 0) at.push(i);
  }
  return at;
}

/** For each line, true when it belongs to a lowercase SQL statement: its first line to the one ending in ";". */
function sqlStatementLines(lines: readonly ScannedLine[]): boolean[] {
  const sql = lines.map(() => false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].blank || !SQL_START.test(bodyOf(lines[i].line))) continue;
    let last = i;
    while (last < lines.length - 1 && last - i < SQL_REACH && !lines[last].line.trimEnd().endsWith(';') && !lines[last + 1].blank) last++;
    const statement = lines.slice(i, last + 1).map((l) => bodyOf(l.line));
    if (!SQL_KEYWORD.test(statement.join(' ').replace(SQL_START, ''))) continue;
    for (let j = i; j <= last; j++) sql[j] = true;
    i = last;
  }
  return sql;
}

/** For each line, true when it is a "#" comment line in a run of them right above or under a command line. */
function commentsByCommands(lines: readonly ScannedLine[], command: readonly boolean[]): boolean[] {
  const comment = lines.map((l) => !l.blank && COMMENT_LINE.test(bodyOf(l.line)));
  const near = lines.map(() => false);
  for (let i = 1; i < lines.length; i++) near[i] = comment[i] && (command[i - 1] || near[i - 1]);
  for (let i = lines.length - 2; i >= 0; i--) near[i] = near[i] || (comment[i] && (command[i + 1] || near[i + 1]));
  return near;
}

/**
 * Ranges of maybe-command text in each paragraph, by id (unsorted): the sentences with a weak sign, and whole lines
 * of a lowercase SQL statement or of a comment next to a command. `command` marks the surely-command lines, and
 * `inSentences` the commands found inside each line's sentences (their sentences are maybe as a whole: "git commit
 * -am wip, the the rest" ends its command at the comma, Task F21c item 4).
 */
export function findMaybeCommandSpans(
  paras: readonly Paragraph[],
  lines: readonly ScannedLine[],
  command: readonly boolean[],
  inSentences: ReadonlyMap<number, readonly Span[]>,
): Map<number, Span[]> {
  const found = new Map<number, Span[]>(paras.map((p) => [p.id, []]));
  const sql = sqlStatementLines(lines);
  const comments = commentsByCommands(lines, command);
  lines.forEach(({ paraId, start, line, blank }, i) => {
    if (blank || command[i]) return;
    const spans = found.get(paraId)!;
    if (sql[i] || comments[i]) {
      spans.push({ start, end: start + line.length });
      return;
    }
    const at = [...weakSigns(line), ...(inSentences.get(i) ?? []).map((s) => s.start)];
    for (const s of sentencesHolding(line, at)) spans.push({ start: start + s.start, end: start + s.end });
  });
  return found;
}
