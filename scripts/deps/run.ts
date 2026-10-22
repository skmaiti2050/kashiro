// Running developer tools (npm, cargo, cargo-audit, ...) for deps:status and upgrade:check (Task S8).
import { spawnSync } from 'node:child_process';

export interface ToolResult {
  /** "missing": the tool is not installed; deps:status warns and goes on. */
  status: 'ok' | 'failed' | 'missing';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Wall-clock seconds. */
  seconds: number;
}

/** What a shell or cargo prints for a tool that is not installed. */
const NOT_INSTALLED = /no such command|is not recognized as an internal or external command|command not found/i;

/**
 * Runs `command` (fixed text written in these scripts, never user input) through the shell, so that
 * npm.cmd and npx.cmd resolve on Windows. A non-zero exit is a result, not an exception.
 */
export function runTool(command: string, cwd: string): ToolResult {
  const started = Date.now();
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? result.error?.message ?? '';
  if (result.status === 127 || (result.status !== 0 && NOT_INSTALLED.test(stderr))) {
    return { status: 'missing', exitCode: result.status, stdout, stderr, seconds };
  }
  return { status: result.status === 0 ? 'ok' : 'failed', exitCode: result.status, stdout, stderr, seconds };
}

/** The value after `flag` in the command-line arguments: "--samples <folder>". */
export function argumentAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** Every value of a repeated flag: "--expect tokio --expect mio" gives ["tokio", "mio"]. */
export function argumentsAfter(argv: string[], flag: string): string[] {
  return argv.flatMap((arg, i) => (arg === flag && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
}

/** The last `count` lines of a tool's output, for a report. */
export function lastLines(text: string, count: number): string {
  return text.trimEnd().split(/\r?\n/).slice(-count).join('\n');
}
