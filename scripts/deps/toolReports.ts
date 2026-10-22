/**
 * Reading the JSON reports of npm outdated, npm audit and cargo audit for deps:status (Task S8). A tool
 * that failed (no output, an error JSON, text instead of JSON, an unexpected shape) gives "could not
 * check" with the reason, never an empty, clean-looking report.
 */
import { lastLines, type ToolResult } from './run';

export type ToolReport<T> = { ok: true; value: T } | { ok: false; reason: string };

export type NpmOutdated = Record<string, { current?: string; wanted: string; latest: string }>;
export interface NpmAudit {
  vulnerabilities: Record<string, { severity: string; via: (string | { title?: string; url?: string })[] }>;
  metadata?: { vulnerabilities?: Record<string, number> };
}
export interface CargoAudit {
  vulnerabilities: { count?: number; list: { advisory: { id: string; title: string }; package: { name: string; version: string } }[] };
  warnings?: Record<string, { kind?: string; advisory?: { id: string; title: string } | null; package: { name: string; version: string } }[]>;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The parsed report when it has the expected shape. The exit code alone says nothing: npm outdated and
 * both audits exit 1 when they found something.
 */
function readReport<T>(result: ToolResult, hasExpectedShape: (json: Json) => boolean): ToolReport<T> {
  if (result.status === 'missing') return { ok: false, reason: 'not installed' };
  if (!result.stdout.trim()) return { ok: false, reason: `no output (exit ${result.exitCode}): ${lastLines(result.stderr, 1)}`.trimEnd() };
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: 'output is not JSON' };
  }
  if (isObject(json) && 'error' in json) {
    const error = json.error as { summary?: string; message?: string } | string;
    const text = typeof error === 'string' ? error : (error?.summary ?? error?.message ?? JSON.stringify(error));
    return { ok: false, reason: `error: ${text}` };
  }
  if (!isObject(json) || !hasExpectedShape(json)) return { ok: false, reason: 'unexpected output' };
  return { ok: true, value: json as T };
}

export const readNpmOutdated = (result: ToolResult): ToolReport<NpmOutdated> =>
  readReport(result, (json) => Object.values(json).every((entry) => isObject(entry) && typeof entry.latest === 'string'));

export const readNpmAudit = (result: ToolResult): ToolReport<NpmAudit> => readReport(result, (json) => isObject(json.vulnerabilities));

export const readCargoAudit = (result: ToolResult): ToolReport<CargoAudit> =>
  readReport(result, (json) => isObject(json.vulnerabilities) && Array.isArray(json.vulnerabilities.list));
