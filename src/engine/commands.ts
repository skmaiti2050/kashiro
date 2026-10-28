import type { Span } from './types';

/**
 * Command-like text (Task F20 item 1, owner decision 2026-10-28): a runbook's commands break when a rule
 * "fixes" them ("--region" → "–region", "ap-south-1 \" → "ap-south-1\", "sudo" → "Sudo"). Only spelling is
 * ever asked there; tierOf hides every other rule's flag on these spans.
 */

/** Words that start a shell command when they start a line, written in lowercase ("sudo systemctl stop nginx"). */
export const COMMAND_WORDS: ReadonlySet<string> = new Set([
  'sudo', 'aws', 'docker', 'kubectl', 'git', 'npm', 'npx', 'pip', 'python', 'curl', 'ssh', 'scp', 'cd', 'ls', 'cat',
  'echo', 'export', 'chmod', 'chown', 'systemctl', 'find', 'xargs', 'sed', 'grep', 'terraform', 'helm',
]);

/** An option token, not glued to a word or a number: "--region", "--region=ap-south-1", "-v" (not "-5", "well-known", "--"). */
const OPTION = /(?<![\p{L}\p{N}_\-./\\])--?[A-Za-z][\w-]*(?:=[^\s]*)?/gu;
/** Inline code in backticks: "`npm --version`". */
const INLINE_CODE = /`[^`\n]+`/g;
/** A shell prompt and a lowercase word at a line start: "$ docker", "> kubectl" (not "$ 500", "> This is a quote"). */
const PROMPT_START = /^[ \t]*[$>][ \t]+[a-z]/;
/** The first word of a line, after its indentation: "sudo" in "  sudo reboot". */
const FIRST_WORD = /^[ \t]*([a-z]+)(?=[ \t]|$)/;
/** Whitespace then a "\" at the line's end: a shell line continuation ("ap-south-1 \"). */
const CONTINUATION = /[ \t]\\$/;
/** One line and the break after it ("\n", "\r\n" or "\r"). */
const LINE = /[^\r\n]*(?:\r\n|\r|\n|$)/g;

function startsCommand(line: string): boolean {
  if (PROMPT_START.test(line)) return true;
  const word = FIRST_WORD.exec(line)?.[1];
  return word !== undefined && COMMAND_WORDS.has(word);
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

/**
 * Command blocks: a line that starts with a command word or a prompt, or ends with a continuation "\", plus each
 * line a continuation carries on to. Whole lines, indentation included.
 */
function commandBlocks(text: string): Span[] {
  const spans: Span[] = [];
  let open: Span | null = null;
  for (const { start, line } of linesOf(text)) {
    const end = start + line.length;
    if (open) open.end = end;
    else if (startsCommand(line) || CONTINUATION.test(line)) open = { start, end };
    if (open && !CONTINUATION.test(line)) {
      spans.push(open);
      open = null;
    }
  }
  if (open) spans.push(open);
  return spans;
}

/** Ranges of command-like text in a paragraph: option tokens, inline code and command blocks. Sorted, merged. */
export function findCommandSpans(text: string): Span[] {
  const spans: Span[] = commandBlocks(text);
  for (const re of [OPTION, INLINE_CODE]) {
    for (const m of text.matchAll(re)) spans.push({ start: m.index!, end: m.index! + m[0].length });
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}
