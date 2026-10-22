import { describe, expect, it } from 'vitest';
import { licenceVerdict, readCargoAudit, readCargoUpdate, readNpmAudit, readNpmOutdated } from '../../scripts/deps/toolReports';
import type { ToolResult } from '../../scripts/deps/run';

const result = (stdout: string, status: ToolResult['status'] = 'ok', stderr = ''): ToolResult => ({
  status,
  exitCode: status === 'ok' ? 0 : 1,
  stdout,
  stderr,
  seconds: 0,
});

const NPM_ERROR = JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'request to https://registry.npmjs.org failed', detail: '' } });

/** Every way a tool can fail to give an answer must read as "could not check", never as clean. */
describe.each([
  ['npm outdated', readNpmOutdated],
  ['npm audit', readNpmAudit],
  ['cargo audit', readCargoAudit],
] as const)('%s output', (_tool, read) => {
  it('empty output (the tool failed before printing anything) is not clean', () => {
    expect(read(result('', 'failed', 'error: could not fetch advisory database'))).toEqual({
      ok: false,
      reason: 'no output (exit 1): error: could not fetch advisory database',
    });
  });

  it('an error JSON is not clean', () => {
    expect(read(result(NPM_ERROR, 'failed'))).toEqual({ ok: false, reason: 'error: request to https://registry.npmjs.org failed' });
  });

  it('non-JSON output is not clean, and does not crash', () => {
    expect(read(result('npm WARN something went wrong', 'failed'))).toEqual({ ok: false, reason: 'output is not JSON' });
  });

  it('JSON of the wrong shape is not clean', () => {
    expect(read(result('[1, 2]'))).toEqual({ ok: false, reason: 'unexpected output' });
  });

  it('a missing tool is reported as not installed', () => {
    expect(read(result('', 'missing'))).toEqual({ ok: false, reason: 'not installed' });
  });
});

describe('readCargoUpdate (cargo update --dry-run --verbose)', () => {
  it('a failed run (offline) is not "0 changes"', () => {
    const offline = result('', 'failed', '    Updating crates.io index\nerror: failed to get `serde` as a dependency: network unreachable');
    expect(readCargoUpdate(offline)).toEqual({ ok: false, reason: 'exit 1: error: failed to get `serde` as a dependency: network unreachable' });
    expect(readCargoUpdate(result('', 'missing'))).toEqual({ ok: false, reason: 'not installed' });
  });

  it('reads the changes and the held-back crates', () => {
    const stderr = [
      '    Updating crates.io index',
      '     Locking 2 packages to latest compatible versions',
      '    Updating tokio v1.54.0 -> v1.54.1',
      '    Removing png v0.17.16',
      '   Unchanged toml v0.8.2 (available: v0.8.23)',
      'warning: not updating lockfile due to dry run',
    ].join('\n');
    expect(readCargoUpdate(result('', 'ok', stderr))).toEqual({
      ok: true,
      value: { changes: ['Updating tokio v1.54.0 -> v1.54.1', 'Removing png v0.17.16'], heldBack: ['Unchanged toml v0.8.2 (available: v0.8.23)'] },
    });
  });
});

describe('licenceVerdict (the deps:status headline)', () => {
  it('says "not fully checked" when a licence check was skipped, never "all on the allowlist"', () => {
    expect(licenceVerdict(false, ['crates: cargo-deny is not installed'])).toBe('Licences: not fully checked (crates: cargo-deny is not installed).');
  });

  it('a failure wins over a skipped check', () => {
    expect(licenceVerdict(true, ['crates: cargo-deny is not installed'])).toBe(
      'FAILED: a licence is not on the allowlist or could not be read. Also not checked: crates: cargo-deny is not installed.',
    );
    expect(licenceVerdict(true, [])).toBe('FAILED: a licence is not on the allowlist or could not be read.');
  });

  it('says all on the allowlist only when every check ran', () => {
    expect(licenceVerdict(false, [])).toBe('Licences: all on the allowlist.');
  });
});

describe('the answers of tools that worked', () => {
  it('npm outdated: nothing outdated is {}, something outdated exits 1 and is still an answer', () => {
    expect(readNpmOutdated(result('{}'))).toEqual({ ok: true, value: {} });
    const outdated = { vite: { current: '8.3.4', wanted: '8.3.4', latest: '8.3.5' } };
    expect(readNpmOutdated(result(JSON.stringify(outdated), 'failed'))).toEqual({ ok: true, value: outdated });
  });

  it('npm audit: vulnerabilities found exits 1 and is still an answer', () => {
    const audit = { vulnerabilities: { x: { severity: 'high', via: ['y'] } }, metadata: { vulnerabilities: { high: 1 } } };
    expect(readNpmAudit(result(JSON.stringify(audit), 'failed'))).toEqual({ ok: true, value: audit });
  });

  it('cargo audit: a report has a vulnerabilities list', () => {
    const audit = { vulnerabilities: { found: false, count: 0, list: [] }, warnings: {} };
    expect(readCargoAudit(result(JSON.stringify(audit)))).toEqual({ ok: true, value: audit });
    expect(readCargoAudit(result(JSON.stringify({ vulnerabilities: {} })))).toEqual({ ok: false, reason: 'unexpected output' });
  });
});
