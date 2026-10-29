import type { Candidate, Paragraph, Span } from './types';
import { FUNCTION_WORDS } from './tiers';
import { overlapsLocked } from './factLock';
import { WORD_REWRITE_KINDS } from './wordFlags';

/**
 * Command-like text (Task F20 item 1, owner decision 2026-10-28): a runbook's commands break when a rule
 * "fixes" them ("--region" → "–region", "ap-south-1 \" → "ap-south-1\", "sudo" → "Sudo"). Only spelling is
 * ever asked there; tierOf hides every other rule's flag on these spans.
 *
 * Commands are found by their shape (Task F21 item A, owner): a line with an option, a variable, a pipe or a
 * redirect, a loop keyword, a here-document, a trailing "\" or a command word at its start is a command line, and
 * the block grows over here-document bodies, continuation and open-quote lines, indented lines and comments under
 * it, across paragraphs (a .docx puts each line in its own). In a sentence, a command runs from a command word to
 * the end of its clause. A line that reads as a sentence is never a whole command line by a weak sign alone, so
 * "use the --verbose flag; then retry." keeps its prose fixes.
 */

/** Words that start a shell command at a line's start, written in lowercase ("sudo systemctl stop nginx", "go run ."). */
export const COMMAND_WORDS: ReadonlySet<string> = new Set([
  'sudo', 'aws', 'docker', 'kubectl', 'git', 'npm', 'npx', 'pip', 'python', 'curl', 'ssh', 'scp', 'cd', 'ls', 'cat',
  'echo', 'export', 'chmod', 'chown', 'systemctl', 'find', 'xargs', 'sed', 'grep', 'terraform', 'helm',
  // Bare command lines with no other sign of a command (Task F21 item A: "make the the", "brew install jq").
  'apt', 'apt-get', 'brew', 'cargo', 'cp', 'gh', 'go', 'journalctl', 'kill', 'make', 'mkdir', 'mv', 'node', 'openssl',
  'ps', 'rg', 'rm', 'service', 'source', 'su', 'tail', 'tar', 'tee', 'touch', 'unzip', 'wget', 'yarn', 'yum',
]);

/** The command words that are no English word, so they start a command inside a sentence too ("Scripts use sudo su ubuntu"). */
export const PROSE_COMMAND_WORDS: ReadonlySet<string> = new Set([
  'apt-get', 'aws', 'chmod', 'chown', 'docker', 'gh', 'git', 'grep', 'journalctl', 'kubectl', 'npm', 'npx', 'openssl',
  'scp', 'sed', 'ssh', 'sudo', 'systemctl', 'terraform', 'wget', 'xargs', 'yum',
]);

/** An option token, not glued to a word or a number: "--region", "--region=ap-south-1", "-v" (not "-5", "well-known", "--"). */
const OPTION = /(?<![\p{L}\p{N}_\-./\\])--?[A-Za-z][\w-]*(?:=[^\s]*)?/gu;
/** A shell variable or command substitution: "$HOME", "${SRC}", "$(date)" (not "$5" or "$ 500"). */
const VARIABLE = /\$(?:\{[^}\s]+\}|\([^)\n]*\)|[A-Za-z_]\w*)/g;
/** Inline code in backticks: "`npm --version`". */
const INLINE_CODE = /`[^`\n]+`/g;
/** A shell prompt and a lowercase word at a line start: "$ docker", "> kubectl" (not "$ 500", "> This is a quote"). */
const PROMPT_START = /^[ \t]*[$>][ \t]+[a-z]/;
/** A list label and the indentation before a line's text: "1. ", "2) ", "- ", "  * ". */
const LIST_LABEL = /^[ \t]*(?:[-*+•]|\d{1,3}[.)])[ \t]+/;
/** Indentation at a line's start. */
const INDENTATION = /^[ \t]+/;
/** The first word of a line's text: "sudo" in "sudo reboot", "apt-get" in "apt-get install curl". */
const FIRST_WORD = /^([a-z][a-z0-9-]*)(?=[ \t]|$)/;
/** Whitespace then a "\" at the line's end: a shell line continuation ("ap-south-1 \"). */
const CONTINUATION = /[ \t]\\$/;
/** A pipe or list operator between words: "| tail", "&& ls", "|| exit" (a Markdown table's row starts with "|"). */
const OPERATOR = /[ \t](?:\|\|?|&&)[ \t]+\S/;
/** A redirect to or from a file or stream: "> out.log", ">> /var/log/x", "2>&1", "< file.txt" (not "x > y"). */
const REDIRECT = /\S[ \t]*(?:[12]?>>?|&>|<)[ \t]*(?:&[12]\b|[~.]?\/[\w./-]+|[\w-]+\.[A-Za-z]\w*)/;
/** A here-document start: "<<EOF", "<<-EOF", "<<'EOF'" (group 2: its end word); not a here-string "<<<". */
const HEREDOC = /(?<!<)<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1/;
/** A loop or test header ("for i in 1 2; do", "if [ -f x ]; then") or a keyword line closing one ("done", "fi"). */
const SHELL_KEYWORD_LINE = /^(?:(?:for|while|until|if|elif|select)[ \t][^\n]*;[ \t]*(?:do|then)\b|(?:do|done|fi|esac|then|else)[ \t]*(?:$|[;<>|&#]))/;
/** A comment or shebang line: "# Install docker if not present", "#!/bin/bash". */
const COMMENT_LINE = /^#(?:!|[ \t]|$)/;
/** A make target over its tab-indented recipe: "build:", "test: lint". */
const MAKE_TARGET = /^[\w./-]+:(?:[ \t]+[^=\s][^=]*)?$/;
/** A line that starts with whitespace and has text. */
const INDENTED = /^[ \t]+\S/;
/** A sentence start: a capitalised word, then a lowercase one ("Scripts use", "*The tea", "“We said"). */
const PROSE_START = /^[*_"'“‘(]*\p{Lu}\p{Ll}*[ \t]+\p{Ll}/u;
/** A sentence end: ".", "!" or "?" after a word, a number, a bracket or a quote ("…switch user."; not "go run ."). */
const SENTENCE_END = /[\p{L}\p{N})"'”’][.!?]$/u;
/** One line and the break after it ("\n", "\r\n" or "\r"). */
const LINE = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
/** A line break and nothing else: two command lines in a row are one block. */
const LINE_BREAK_ONLY = /^(?:\r\n|\r|\n)$/;
/** Where a quote may open: after whitespace, "=", "(", "[", "{", ":" or "," (not the apostrophe in "don't"). */
const QUOTE_OPENER = /[\s=([{:,]/;

/** A command word inside a sentence (PROSE_COMMAND_WORDS), not part of a longer word, path, URL or inline code. */
const PROSE_COMMAND = new RegExp(`(?<![\\p{L}\\p{N}_./\`-])(?:${[...PROSE_COMMAND_WORDS].join('|')})(?![\\p{L}\\p{N}_/-])`, 'gu');
/** A lowercase word right before an option or a variable: "make" in "make -j4", "echo" in "echo $HOME". */
const WORD_BEFORE_ARGUMENT = /(?<![\p{L}\p{N}_./`-])\p{Ll}[\p{Ll}\p{N}_-]*(?=[ \t]+(?:--?[A-Za-z]|\$[{(A-Za-z_]))/gu;
/** An article or determiner right before a word: "the" in "the docker daemon" (a noun there, not a command). */
const DETERMINER_BEFORE = /(?:^|[^\p{L}])(?:the|a|an|this|that|your|our|my|its|their)[ \t]+$/iu;
/** A shell keyword right before a command: "until " in "until sudo docker pull". */
const KEYWORD_BEFORE = /(?:^|[ \t])((?:until|while|if|then|do|else|for)[ \t]+)$/;
/** Where a command in a sentence ends: ".", "!", "?" or "," before a space, or "; " before a prose word ("; we", not "; do"). */
const CLAUSE_END = /[.!?,](?=\s|$)|;(?=[ \t]+(?!(?:do|done|then|fi|else|esac)\b)\p{Ll})/u;

/** Lines an open quote may run on for; one never closed is a stray apostrophe, and carries nothing on. */
const QUOTE_REACH = 10;
/** Lines a here-document may run on for before its end word; without one it carries nothing on. */
const HEREDOC_REACH = 200;

/** A line's text without its list label or indentation. */
const bodyOf = (line: string) => line.replace(LIST_LABEL, '').replace(INDENTATION, '');

/** True when the line reads as a sentence: a capitalised word then a lowercase one, or a sentence-final mark. */
function readsAsProse(body: string): boolean {
  return PROSE_START.test(body) || SENTENCE_END.test(body.trimEnd());
}

/**
 * True for a command line on its own signs. Strong signs (a trailing "\", a here-document, a prompt, a loop keyword
 * line) always count; weak ones (an option, a variable, an operator, a redirect, a command word at the start) only
 * on a line that doesn't read as a sentence. An English command word ("make", "go") counts only without a list label.
 */
function isCommandLine(line: string): boolean {
  const body = bodyOf(line);
  if (CONTINUATION.test(line) || HEREDOC.test(line) || PROMPT_START.test(line) || SHELL_KEYWORD_LINE.test(body)) return true;
  if (readsAsProse(body)) return false;
  if (line.search(OPTION) >= 0 || line.search(VARIABLE) >= 0 || REDIRECT.test(line)) return true;
  if (!body.startsWith('|') && OPERATOR.test(line)) return true;
  const word = FIRST_WORD.exec(body)?.[1];
  if (word === undefined || !COMMAND_WORDS.has(word)) return false;
  return PROSE_COMMAND_WORDS.has(word) || !LIST_LABEL.test(line);
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
function heredocEnd(lines: readonly string[], at: number, word: string): number {
  for (let i = at + 1; i < lines.length && i <= at + HEREDOC_REACH; i++) if (lines[i].trim() === word) return i;
  return at;
}

/** For each line, true when it is command text (see the file comment). Lines run on across paragraphs. */
function markCommandLines(lines: readonly string[]): boolean[] {
  const command = lines.map(() => false);
  let heredocLast = -1;
  let quote: string | null = null;
  let continues = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i <= heredocLast) {
      command[i] = true;
      continue;
    }
    const underCommand = i > 0 && command[i - 1] && (INDENTED.test(line) || COMMENT_LINE.test(bodyOf(line)));
    command[i] = continues || quote !== null || underCommand || isCommandLine(line);
    if (!command[i]) continue;
    quote = quoteLeftOpen(line, quote);
    const open = quote;
    if (open !== null && !lines.slice(i + 1, i + 1 + QUOTE_REACH).some((l) => l.includes(open))) quote = null;
    continues = CONTINUATION.test(line);
    const here = quote === null ? HEREDOC.exec(line) : null;
    if (here) heredocLast = heredocEnd(lines, i, here[2]);
  }
  // A comment line, or a make target over its tab-indented recipe, directly above a command block belongs to it.
  for (let i = lines.length - 2; i >= 0; i--) {
    if (command[i] || !command[i + 1]) continue;
    if (COMMENT_LINE.test(bodyOf(lines[i])) || (MAKE_TARGET.test(lines[i]) && lines[i + 1].startsWith('\t'))) command[i] = true;
  }
  return command;
}

/**
 * Commands inside a sentence: from a command word, or a lowercase word before an option or a variable ("echo $HOME";
 * not a function word: "is $HOME"), to the end of its clause. A shell keyword right before it is included ("until sudo").
 */
function proseCommandSpans(line: string): Span[] {
  const starts: number[] = [];
  for (const m of line.matchAll(PROSE_COMMAND)) if (!DETERMINER_BEFORE.test(line.slice(0, m.index))) starts.push(m.index!);
  for (const m of line.matchAll(WORD_BEFORE_ARGUMENT)) if (!FUNCTION_WORDS.has(m[0])) starts.push(m.index!);
  const spans: Span[] = [];
  for (const at of starts.sort((a, b) => a - b)) {
    if (spans.length > 0 && at < spans[spans.length - 1].end) continue;
    const start = at - (KEYWORD_BEFORE.exec(line.slice(0, at))?.[1].length ?? 0);
    const clause = CLAUSE_END.exec(line.slice(at));
    let end = clause ? at + clause.index : line.length;
    while (end > at && /\s/.test(line[end - 1])) end--;
    spans.push({ start, end });
  }
  return spans;
}

/** Each line of `text`, without its break, and where it starts. */
function linesOf(text: string): { start: number; line: string }[] {
  const out: { start: number; line: string }[] = [];
  for (const m of text.matchAll(LINE)) {
    if (m[0] === '' && m.index! === text.length && out.length > 0) break;
    out.push({ start: m.index!, line: m[0].replace(/\r?\n$|\r$/, '') });
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

/**
 * Ranges of command-like text in each paragraph, by id: command lines and blocks, commands in sentences, option
 * tokens, variables and inline code. Paragraphs are read in order, so a block runs on into the next one.
 */
export function findCommandSpansInParagraphs(paras: readonly Paragraph[]): Map<number, Span[]> {
  const lines = paras.flatMap((p) => linesOf(p.text).map((l) => ({ paraId: p.id, ...l })));
  const command = markCommandLines(lines.map((l) => l.line));
  const found = new Map<number, Span[]>(paras.map((p) => [p.id, []]));
  lines.forEach(({ paraId, start, line }, i) => {
    const spans = found.get(paraId)!;
    if (command[i]) spans.push({ start, end: start + line.length });
    else for (const s of proseCommandSpans(line)) spans.push({ start: start + s.start, end: start + s.end });
  });
  return new Map(
    paras.map((p) => {
      const spans = found.get(p.id)!;
      for (const re of [OPTION, VARIABLE, INLINE_CODE]) {
        for (const m of p.text.matchAll(re)) spans.push({ start: m.index!, end: m.index! + m[0].length });
      }
      return [p.id, merged(p.text, spans)];
    }),
  );
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

/** Ranges of command-like text in one paragraph on its own (see findCommandSpansInParagraphs). Sorted, merged. */
export function findCommandSpans(text: string): Span[] {
  return findCommandSpansInParagraphs([{ id: 0, text }]).get(0)!;
}
