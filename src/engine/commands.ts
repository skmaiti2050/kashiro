import type { Candidate, Paragraph, Span } from './types';
import { FUNCTION_WORDS } from './tiers';
import { overlapsLocked } from './factLock';
import { WORD_REWRITE_KINDS } from './wordFlags';
import {
  bodyOf,
  COMMAND_WORDS,
  ENGLISH_COMMAND_WORDS,
  FILE_NAME,
  HEREDOC,
  INLINE_CODE,
  linesOf,
  LIST_LABEL,
  OPERATOR,
  OPTION,
  PATH,
  PROSE_COMMAND_WORDS,
  readsAsProse,
  REDIRECT,
  SHELL_KEYWORD_LINE,
  SUBSTITUTION,
  VARIABLE,
} from './commandShapes';
import { findMaybeCommandSpans, type ScannedLine } from './maybeCommands';
import { SHORT_TECHNICAL_WORDS } from './wordlists/technical';

export { COMMAND_WORDS, ENGLISH_COMMAND_WORDS, PROSE_COMMAND_WORDS } from './commandShapes';

/**
 * Command-like text (Task F20 item 1, owner decision 2026-10-28): a runbook's commands break when a rule
 * "fixes" them ("--region" → "–region", "ap-south-1 \" → "ap-south-1\", "sudo" → "Sudo"). Only spelling is
 * ever asked there; tierOf hides every other rule's flag on these spans.
 *
 * Commands are found by their shape (Task F21 item A, owner), at two levels (Task F21c, owner: ambiguous goes to
 * review):
 * - **Surely a command**: a trailing "\", a closed here-document, a "$ " prompt, a loop or test block, a line that
 *   starts with a command word (an English one only on a short line or with a second sign), or a command-like first
 *   token with an option, a variable, a pipe or a redirect. The block grows over here-document bodies, continuation
 *   and open-quote lines, indented lines under it that are no sentence, and a make target's recipe, across
 *   paragraphs (a .docx puts each line in its own) but never across a blank line. In a sentence, a command runs from
 *   a non-English command word to the end of its clause when the clause has a second sign.
 * - **Maybe a command** (maybeCommands.ts): any weak sign. Its fixes are offered, but none starts ticked and none
 *   is made without a click.
 */

/** A "$ " prompt and a lowercase word at a line start: "$ docker" (not "$ 500"). */
const DOLLAR_PROMPT = /^[ \t]*\$[ \t]+[a-z]/;
/** A "> " prompt and the word after it: "> kubectl get pods" (a quote line "> i think so" is checked by its word). */
const ANGLE_PROMPT = /^[ \t]*>[ \t]+([a-z][a-z0-9-]*)(?=[ \t]|$)/;
/** The first word of a line's text: "sudo" in "sudo reboot", "apt-get" in "apt-get install curl". */
const FIRST_WORD = /^([a-z][a-z0-9-]*)(?=[ \t]|$)/;
/**
 * A first token shaped like a program, not a word: a digit, "_", or an inner ".", "/" or "-" before a letter or
 * digit ("Set-ExecutionPolicy", "docker-compose", "./run.sh", "pm2"; not "e.g.", "rahul:"), or a Makefile or shell
 * variable being set ("CFLAGS = -O2").
 */
const PROGRAM_TOKEN = /^(?:\.{1,2}|~)?\/?[A-Za-z][\w-]*(?:[\d_]|[./-]\w)[\w./-]*(?<!\.)(?=[ \t]|$)|^[A-Z][A-Z0-9_]*[ \t]*[?:+]?=/;
/** An option first on a line: the argument lines of a long command ("  --output table"; not "-5 degrees"). */
const OPTION_FIRST = /^--?[A-Za-z][\w-]*(?:=\S*)?(?=[ \t]|$)/;
/** Whitespace then a "\" at the line's end: a shell line continuation ("ap-south-1 \"). */
const CONTINUATION = /[ \t]\\$/;
/** A loop or test opened and closed on one line: "for i in 1 2 3; do echo $i; done", "if true; then echo hi; fi". */
const KEYWORD_BLOCK_ON_LINE = /;[ \t]*(?:do|then)\b.*\b(?:done|fi)\b/;
/** A make target over its tab-indented recipe: "build:", "test: lint". */
const MAKE_TARGET = /^[\w./-]+:(?:[ \t]+[^=\s][^=]*)?$/;
/** A line that starts with whitespace and has text. */
const INDENTED = /^[ \t]+\S/;
/** A line break and nothing else: two command lines in a row are one block. */
const LINE_BREAK_ONLY = /^(?:\r\n|\r|\n)$/;
/** Where a quote may open: after whitespace, "=", "(", "[", "{", ":" or "," (not the apostrophe in "don't"). */
const QUOTE_OPENER = /[\s=([{:,]/;
/** Whitespace-separated tokens. */
const TOKEN = /\S+/g;

/** A command word inside a sentence (PROSE_COMMAND_WORDS), not part of a longer word, path, URL or inline code. */
const PROSE_COMMAND = new RegExp(`(?<![\\p{L}\\p{N}_./\`-])(?:${[...PROSE_COMMAND_WORDS].join('|')})(?![\\p{L}\\p{N}_/-])`, 'gu');
/** A command word that is no English word as the next word after a command: "su" in "sudo su ubuntu". */
const NEXT_COMMAND_WORD = new RegExp(`^[ \\t]+(?:${[...COMMAND_WORDS].filter((w) => !ENGLISH_COMMAND_WORDS.has(w)).join('|')})(?![\\p{L}\\p{N}_/-])`, 'u');
/** A lowercase word right before an option or a variable: "make" in "make -j4", "echo" in "echo $HOME". */
const WORD_BEFORE_ARGUMENT = /(?<![\p{L}\p{N}_./`-])\p{Ll}[\p{Ll}\p{N}_-]*(?=[ \t]+(?:--?[A-Za-z]|\$[{(A-Za-z_]))/gu;
/** An article or determiner right before a word: "the" in "the docker daemon" (a noun there, not a command). */
const DETERMINER_BEFORE = /(?:^|[^\p{L}])(?:the|a|an|this|that|your|our|my|its|their)[ \t]+$/iu;
/** A shell keyword right before a command: "until " in "until sudo docker pull". */
const KEYWORD_BEFORE = /(?:^|[ \t])((?:until|while|if|then|do|else|for)[ \t]+)$/;
/** Where a command in a sentence ends: ".", "!", "?" or "," before a space, or "; " before a prose word ("; we", not "; do"). */
const CLAUSE_END = /[.!?,](?=\s|$)|;(?=[ \t]+(?!(?:do|done|then|fi|else|esac)\b)\p{Ll})/gu;
/** A quote opening an argument: '"$X"', "'Reservations'". */
const QUOTED_ARGUMENT = /(?:^|[\s=])["']/;

const SHORT_WORDS: ReadonlySet<string> = new Set(SHORT_TECHNICAL_WORDS);

/** Lines an open quote may run on for; one never closed is a stray apostrophe, and carries nothing on. */
const QUOTE_REACH = 10;
/** Lines a here-document may run on for before its end word; without one it carries nothing on. */
const HEREDOC_REACH = 200;
/** Lines around a loop or test keyword line where the rest of its block must be ("if …; then" … "fi"). */
const KEYWORD_REACH = 5;
/** Words on a line an English command word may start alone ("make the the", "go run ."). */
const SHORT_LINE_WORDS = 3;
/** Characters before a word that are looked at for a determiner or a shell keyword (keeps the scan linear). */
const LOOK_BEHIND = 24;

/** True when the line has a sign of a command other than its first word (an option, a variable, a path, …). */
function hasArgumentSign(line: string): boolean {
  if (line.search(OPTION) >= 0 || line.search(VARIABLE) >= 0 || REDIRECT.test(line)) return true;
  if (line.search(PATH) >= 0 || line.search(FILE_NAME) >= 0) return true;
  return !bodyOf(line).startsWith('|') && OPERATOR.test(line);
}

/**
 * True for a command line on its own signs (here-documents and keyword lines are judged with their neighbours in
 * markCommandLines). A line that reads as a sentence needs a strong sign; an English command word needs a short
 * line or a second sign, and no list label; any other first token needs to look like a program and have a sign.
 */
function isCommandLine(line: string): boolean {
  if (CONTINUATION.test(line) || DOLLAR_PROMPT.test(line)) return true;
  const prompt = ANGLE_PROMPT.exec(line)?.[1];
  if (prompt !== undefined && COMMAND_WORDS.has(prompt)) return true;
  const body = bodyOf(line);
  if (readsAsProse(body)) return false;
  if (SUBSTITUTION.test(line)) return true;
  if (OPTION_FIRST.test(body)) return true;
  const word = FIRST_WORD.exec(body)?.[1];
  if (word === undefined || !COMMAND_WORDS.has(word)) return PROGRAM_TOKEN.test(body) && hasArgumentSign(line);
  if (!ENGLISH_COMMAND_WORDS.has(word)) return true;
  if (LIST_LABEL.test(line)) return false;
  return hasArgumentSign(line) || (body.match(TOKEN)?.length ?? 0) <= SHORT_LINE_WORDS;
}

/** The quote still open at the end of `line`, given the one open at its start (a "'" or '"', or null). */
function quoteLeftOpen(line: string, open: string | null): string | null {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (open !== null) {
      if (ch === open && !(open === '"' && line[i - 1] === '\\')) open = null;
    } else if ((ch === "'" || ch === '"') && (i === 0 || QUOTE_OPENER.test(line[i - 1]))) {
      open = ch;
    }
  }
  return open;
}

/** The index of the line ending the here-document opened on line `at` (its end word alone), or `at` when none does. */
function heredocEnd(lines: readonly ScannedLine[], at: number, word: string): number {
  for (let i = at + 1; i < lines.length && i <= at + HEREDOC_REACH; i++) if (lines[i].line.trim() === word) return i;
  return at;
}

/**
 * For each line, true when a loop or test keyword line is part of a shell block: opened and closed on the line, or
 * with another keyword or command line within KEYWORD_REACH lines and no blank line between ("if you can come; then
 * call me" alone is prose).
 */
function keywordLinesInBlocks(lines: readonly ScannedLine[], own: readonly boolean[]): boolean[] {
  const keyword = lines.map((l) => SHELL_KEYWORD_LINE.test(bodyOf(l.line)));
  return lines.map((l, i) => {
    if (!keyword[i]) return false;
    if (KEYWORD_BLOCK_ON_LINE.test(l.line)) return true;
    const near = (step: number) => {
      for (let j = i + step, n = 1; j >= 0 && j < lines.length && n <= KEYWORD_REACH && !lines[j].blank; j += step, n++) if (keyword[j] || own[j]) return true;
      return false;
    };
    return near(-1) || near(1);
  });
}

/** For each line, true when it is surely command text (see the file comment). Lines run on across paragraphs. */
function markCommandLines(lines: readonly ScannedLine[]): boolean[] {
  const own = lines.map((l) => !l.blank && isCommandLine(l.line));
  const inBlock = keywordLinesInBlocks(lines, own);
  const command = lines.map(() => false);
  let heredocLast = -1;
  let quote: string | null = null;
  let continues = false;
  for (let i = 0; i < lines.length; i++) {
    const { line } = lines[i];
    if (i <= heredocLast) {
      command[i] = true;
      continue;
    }
    // A blank line ends a block; only an open quote runs on over it.
    if (lines[i].blank) {
      continues = false;
      command[i] = quote !== null;
      continue;
    }
    const here = quote === null ? HEREDOC.exec(line) : null;
    const hereLast = here ? heredocEnd(lines, i, here[2]) : i;
    const underCommand = i > 0 && command[i - 1] && INDENTED.test(line) && !readsAsProse(bodyOf(line));
    command[i] = continues || quote !== null || underCommand || own[i] || inBlock[i] || hereLast > i;
    if (!command[i]) continue;
    quote = quoteLeftOpen(line, quote);
    const open = quote;
    if (open !== null && !lines.slice(i + 1, i + 1 + QUOTE_REACH).some((l) => l.line.includes(open))) quote = null;
    continues = CONTINUATION.test(line);
    if (quote === null && hereLast > i) heredocLast = hereLast;
  }
  // A make target directly above its tab-indented recipe belongs to it.
  for (let i = lines.length - 2; i >= 0; i--) {
    if (!command[i] && command[i + 1] && MAKE_TARGET.test(lines[i].line) && lines[i + 1].line.startsWith('\t')) command[i] = true;
  }
  return command;
}

/**
 * True when the rest of a clause after its command word has a second sign of a command: an argument sign, a quoted
 * argument, "=", or another command right after it ("sudo su ubuntu", "git commit -am wip"; not "aws last year").
 */
function clauseHasSign(rest: string): boolean {
  return hasArgumentSign(rest) || NEXT_COMMAND_WORD.test(rest) || QUOTED_ARGUMENT.test(rest) || rest.includes('=');
}

/**
 * Commands inside a sentence: from a non-English command word to the end of its clause, surely when the clause has
 * a second sign ("Scripts use sudo su ubuntu"), else maybe ("I use git for work"). A lowercase word before an
 * option or a variable (not a function word: "is $HOME") starts a maybe clause ("use -v to see"). A shell keyword
 * right before the word is included ("until sudo"). Linear: each clause is read once.
 */
function proseCommandSpans(line: string): { surely: Span[]; maybe: Span[] } {
  const starts: { at: number; named: boolean }[] = [];
  for (const m of line.matchAll(PROSE_COMMAND)) {
    if (!DETERMINER_BEFORE.test(line.slice(Math.max(0, m.index! - LOOK_BEHIND), m.index))) starts.push({ at: m.index!, named: true });
  }
  for (const m of line.matchAll(WORD_BEFORE_ARGUMENT)) if (!FUNCTION_WORDS.has(m[0])) starts.push({ at: m.index!, named: false });
  starts.sort((a, b) => a.at - b.at);
  const out = { surely: [] as Span[], maybe: [] as Span[] };
  let lastEnd = -1;
  for (const { at, named } of starts) {
    if (at < lastEnd) continue;
    CLAUSE_END.lastIndex = at;
    const clause = CLAUSE_END.exec(line);
    let end = clause ? clause.index : line.length;
    while (end > at && /\s/.test(line[end - 1])) end--;
    lastEnd = Math.max(end, at + 1);
    const before = line.slice(Math.max(0, at - LOOK_BEHIND), at);
    const start = at - (KEYWORD_BEFORE.exec(before)?.[1].length ?? 0);
    const sure = named && clauseHasSign(line.slice(at, end).replace(/^\S+/, ''));
    // A short cloud word alone is as often a typo ("It aws a great day"): it needs a second sign (review M-25).
    if (!sure && SHORT_WORDS.has(line.slice(at, end).split(/\s/, 1)[0])) continue;
    (sure ? out.surely : out.maybe).push({ start, end });
  }
  return out;
}

/** `spans` sorted and merged: overlapping ones, and ones only a line break apart (a command block). */
function merged(text: string, spans: Span[]): Span[] {
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && (s.start <= last.end || LINE_BREAK_ONLY.test(text.slice(last.end, s.start)))) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Every line of the paragraphs in order, with a blank line before a paragraph the file sets apart with one. */
function scannedLines(paras: readonly Paragraph[]): ScannedLine[] {
  return paras.flatMap((p) => {
    const lines: ScannedLine[] = linesOf(p.text).map((l) => ({ paraId: p.id, ...l, blank: false }));
    return p.afterBlankLine ? [{ paraId: p.id, start: 0, line: '', blank: true }, ...lines] : lines;
  });
}

/** Command text by level, as ranges per paragraph id (sorted, merged). */
export interface CommandText {
  surely: Map<number, Span[]>;
  maybe: Map<number, Span[]>;
}

/**
 * Ranges of command-like text in each paragraph, by id and level: surely (command lines and blocks, commands in
 * sentences with a second sign, option tokens, variables and inline code) and maybe (any weak sign; see
 * maybeCommands.ts). Paragraphs are read in order, so a block runs on into the next one.
 */
export function findCommandText(paras: readonly Paragraph[]): CommandText {
  const lines = scannedLines(paras);
  const command = markCommandLines(lines);
  const surely = new Map<number, Span[]>(paras.map((p) => [p.id, []]));
  const inSentences = new Map<number, Span[]>();
  lines.forEach(({ paraId, start, line, blank }, i) => {
    if (blank) return;
    if (command[i]) {
      surely.get(paraId)!.push({ start, end: start + line.length });
      return;
    }
    const prose = proseCommandSpans(line);
    for (const s of prose.surely) surely.get(paraId)!.push({ start: start + s.start, end: start + s.end });
    inSentences.set(i, [...prose.surely, ...prose.maybe]);
  });
  for (const p of paras) {
    const spans = surely.get(p.id)!;
    for (const re of [OPTION, VARIABLE, INLINE_CODE]) for (const m of p.text.matchAll(re)) spans.push({ start: m.index!, end: m.index! + m[0].length });
    surely.set(p.id, merged(p.text, spans));
  }
  const maybe = findMaybeCommandSpans(paras, lines, command, inSentences);
  return { surely, maybe: new Map(paras.map((p) => [p.id, merged(p.text, maybe.get(p.id)!)])) };
}

/** Ranges of surely-command text in each paragraph, by id (see findCommandText). */
export function findCommandSpansInParagraphs(paras: readonly Paragraph[]): Map<number, Span[]> {
  return findCommandText(paras).surely;
}

/**
 * A spelling flag on command text without the fixes that only change its case ("docker" → "Docker": the capital
 * names another command, or none; Task F21, review M-17). The linter's list stays in `linterReplacements`.
 */
export function withoutCaseOnlyFixOnCommand(c: Candidate, commandSpans: Span[] | undefined): Candidate {
  if (!WORD_REWRITE_KINDS.has(c.kind) || !overlapsLocked(c, commandSpans)) return c;
  const original = c.original.toLowerCase();
  const kept = c.replacements.filter((r) => r.toLowerCase() !== original);
  if (kept.length === c.replacements.length) return c;
  return { ...c, replacements: kept, linterReplacements: c.linterReplacements ?? c.replacements };
}

/** Ranges of surely-command text in one paragraph on its own (see findCommandText). Sorted, merged. */
export function findCommandSpans(text: string): Span[] {
  return findCommandSpansInParagraphs([{ id: 0, text }]).get(0)!;
}
