import type { Span } from './types';

/**
 * The shapes command text is recognised by (Tasks F20 item 1, F21 item A, F21c), shared by the "surely a command"
 * scan (commands.ts) and the "maybe a command" scan (maybeCommands.ts).
 */

/** Words that start a shell command at a line's start, written in lowercase ("sudo systemctl stop nginx", "go run ."). */
export const COMMAND_WORDS: ReadonlySet<string> = new Set([
  'sudo', 'aws', 'docker', 'kubectl', 'git', 'npm', 'npx', 'pip', 'python', 'curl', 'ssh', 'scp', 'cd', 'ls', 'cat',
  'echo', 'export', 'chmod', 'chown', 'systemctl', 'find', 'xargs', 'sed', 'grep', 'terraform', 'helm',
  // Bare command lines with no other sign of a command (Task F21 item A: "make the the", "brew install jq").
  'apt', 'apt-get', 'brew', 'cargo', 'cp', 'gh', 'go', 'journalctl', 'kill', 'make', 'mkdir', 'mv', 'node', 'openssl',
  'ps', 'rg', 'rm', 'service', 'source', 'su', 'tail', 'tar', 'tee', 'touch', 'unzip', 'wget', 'yarn', 'yum',
]);

/**
 * The command words that are also English words (or "ps", a postscript): a line they start is surely a command only
 * when it is short or has a second sign ("make install", "cat /etc/hosts"; not "make sure the the oven is hot",
 * Task F21c, review M-20).
 */
export const ENGLISH_COMMAND_WORDS: ReadonlySet<string> = new Set([
  'brew', 'cargo', 'cat', 'echo', 'export', 'find', 'go', 'kill', 'make', 'node', 'ps', 'python', 'service', 'source',
  'tail', 'tar', 'tee', 'touch', 'yarn', 'yum',
]);

/** The command words that are no English word, so they start a command inside a sentence too ("Scripts use sudo su ubuntu"). */
export const PROSE_COMMAND_WORDS: ReadonlySet<string> = new Set([
  'apt-get', 'aws', 'chmod', 'chown', 'docker', 'gh', 'git', 'grep', 'journalctl', 'kubectl', 'npm', 'npx', 'openssl',
  'scp', 'sed', 'ssh', 'sudo', 'systemctl', 'terraform', 'wget', 'xargs',
]);

/** An option token, not glued to a word or a number: "--region", "--region=ap-south-1", "-v" (not "-5", "well-known", "--"). */
export const OPTION = /(?<![\p{L}\p{N}_\-./\\])--?[A-Za-z][\w-]*(?:=[^\s]*)?/gu;
/** A shell variable or command substitution: "$HOME", "${SRC}", "$(date)" (not "$5" or "$ 500"). */
export const VARIABLE = /\$(?:\{[^}\s]+\}|\([^)\n]*\)|[A-Za-z_]\w*)/g;
/** A variable in braces or a command substitution, which prose never writes: "${SRC}", "$(date)". */
export const SUBSTITUTION = /\$(?:\{[^}\s]+\}|\([^)\n]*\))/;
/** Inline code in backticks: "`npm --version`". */
export const INLINE_CODE = /`[^`\n]+`/g;
/** A list label and the indentation before a line's text: "1. ", "2) ", "- ", "  * ". */
export const LIST_LABEL = /^[ \t]*(?:[-*+•]|\d{1,3}[.)])[ \t]+/;
/** Indentation at a line's start. */
const INDENTATION = /^[ \t]+/;
/** A pipe or list operator between words: "| tail", "&& ls", "|| exit" (a Markdown table's row starts with "|"). */
export const OPERATOR = /[ \t](?:\|\|?|&&)[ \t]+\S/;
/** A redirect to or from a file or stream: "> out.log", ">> /var/log/x", "2>&1", "< file.txt" (not "x > y"). */
export const REDIRECT = /\S[ \t]*(?:[12]?>>?|&>|<)[ \t]*(?:&[12]\b|[~.]?\/[\w./-]+|[\w-]+\.[A-Za-z]\w*)/;
/** A here-document start: "<<EOF", "<<-EOF", "<<'EOF'" (group 2: its end word); not a here-string "<<<". */
export const HEREDOC = /(?<!<)<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1/;
/** A loop or test header ("for i in 1 2; do", "if [ -f x ]; then") or a keyword line closing one ("done", "fi"). */
export const SHELL_KEYWORD_LINE = /^(?:(?:for|while|until|if|elif|select)[ \t][^\n]*;[ \t]*(?:do|then)\b|(?:do|done|fi|esac|then|else)[ \t]*(?:$|[;<>|&#]))/;
/**
 * A path: "/etc/hosts", "./deploy.sh", "~/x", "/app", "venv/bin/activate" (not "and/or", "w/ ", "1/2/2024", or the
 * "//" of a URL).
 */
export const PATH = /(?<![\p{L}\p{N}_/.:~-])(?:\.{1,2}\/|~\/|\/(?=[a-z_]))[^\s,;)]*|(?<![\p{L}\p{N}_/.-])[\w-]*[A-Za-z][\w-]*\/[\w-]+(?:[./][\w-]+)+/gu;
/** A file name or a glob, by a code, config or archive extension: "app.py", "deploy.sh", "*.json", "notes.txt". */
export const FILE_NAME =
  /(?:\*|(?<![\p{L}\p{N}_.-])[\w-]+)\.(?:sh|bash|py|js|mjs|cjs|ts|tsx|jsx|json|ya?ml|toml|ini|conf|cfg|env|txt|log|md|csv|sql|rb|php|go|rs|java|kt|c|h|cpp|cs|html|css|xml|lock|tgz|tar|gz|zip|exe|bat|cmd|ps1|pem|crt|key|service)(?![\p{L}\p{N}_-])/giu;
/** A comment or shebang line: "# Install docker if not present", "#!/bin/bash". */
export const COMMENT_LINE = /^#(?:!|[ \t]|$)/;
/** A sentence start: a capitalised word, then a lowercase one ("Scripts use", "*The tea", "“We said"). */
const PROSE_START = /^[*_"'“‘(]*\p{Lu}\p{Ll}*[ \t]+\p{Ll}/u;
/** A sentence end: ".", "!" or "?" after a word, a number, a bracket or a quote ("…switch user."; not "go run ."). */
const SENTENCE_END = /[\p{L}\p{N})"'”’][.!?]$/u;
/** One line and the break after it ("\n", "\r\n" or "\r"). */
const LINE = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
/** Where a sentence inside a line ends: ".", "!" or "?" before a space ("…the plan. Then"). */
const SENTENCE_BREAK = /[.!?](?=[ \t])/g;

/** A line's text without its list label or indentation. */
export const bodyOf = (line: string) => line.replace(LIST_LABEL, '').replace(INDENTATION, '');

/** True when the line reads as a sentence: a capitalised word then a lowercase one, or a sentence-final mark. */
export function readsAsProse(body: string): boolean {
  return PROSE_START.test(body) || SENTENCE_END.test(body.trimEnd());
}

/** Each line of `text`, without its break, and where it starts. */
export function linesOf(text: string): { start: number; line: string }[] {
  const out: { start: number; line: string }[] = [];
  for (const m of text.matchAll(LINE)) {
    if (m[0] === '' && m.index! === text.length && out.length > 0) break;
    out.push({ start: m.index!, line: m[0].replace(/\r?\n$|\r$/, '') });
  }
  return out;
}

/** The sentences of one line, in order: each from the line start or a ". " to the next ". " or the line end. */
export function sentencesOf(line: string): Span[] {
  const out: Span[] = [];
  let start = 0;
  for (const m of line.matchAll(SENTENCE_BREAK)) {
    out.push({ start, end: m.index! + 1 });
    start = m.index! + 1;
  }
  out.push({ start, end: line.length });
  return out;
}

/**
 * The sentences of `line` that hold any of `at` (positions, in any order), each once and in order. Linear: one walk
 * over the sorted positions and the sentences.
 */
export function sentencesHolding(line: string, at: readonly number[]): Span[] {
  const sentences = sentencesOf(line);
  const out: Span[] = [];
  let s = 0;
  for (const i of [...at].sort((a, b) => a - b)) {
    while (s < sentences.length - 1 && sentences[s].end <= i) s++;
    if (out[out.length - 1] !== sentences[s]) out.push(sentences[s]);
  }
  return out;
}
