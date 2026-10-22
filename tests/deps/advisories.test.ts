import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { advisoryLines, advisoryVerdict, devActionNeeded, devOnlyVulnerabilities } from '../../scripts/deps/advisories';
import { readNpmAudit, type NpmAudit } from '../../scripts/deps/toolReports';

const fixture = (file: string): NpmAudit => {
  const stdout = fs.readFileSync(path.resolve(__dirname, '../fixtures/audit', file), 'utf8');
  const report = readNpmAudit({ status: 'failed', exitCode: 1, stdout, stderr: '', seconds: 0 });
  if (!report.ok) throw new Error(report.reason);
  return report.value;
};
const full = fixture('npm-audit-full.json');
const production = fixture('npm-audit-production.json');

describe('npm advisories split into production and dev tools (deps:status)', () => {
  const dev = devOnlyVulnerabilities(full, production);

  it('dev-only advisories are those in the full audit that the production audit does not have', () => {
    expect(Object.keys(dev).sort()).toEqual(['@vitest/mocker', 'tinypool', 'vitest']);
  });

  it('high and critical dev advisories are "action needed", moderate ones are not', () => {
    expect(devActionNeeded(dev)).toEqual([
      'action needed: dev tool tinypool (critical): Prototype pollution leading to remote code execution (https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)',
      'action needed: dev tool vitest (critical): via tinypool; via @vitest/mocker',
    ]);
  });

  it('lists each advisory with its link', () => {
    expect(advisoryLines(dev)).toEqual([
      '- **@vitest/mocker** (moderate): Example mocker advisory (https://github.com/advisories/GHSA-82fw-gwwq-j7x9)',
      '- **tinypool** (critical): Prototype pollution leading to remote code execution (https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)',
      '- **vitest** (critical): via tinypool; via @vitest/mocker',
    ]);
  });

  it('a production advisory fails deps:status; dev advisories alone do not', () => {
    expect(advisoryVerdict(production.vulnerabilities, dev)).toEqual({
      failed: true,
      text: 'FAILED: 1 production npm advisory (shipped-lib). Action needed: 2 high or critical dev-tool advisories.',
    });
    expect(advisoryVerdict({}, dev)).toEqual({ failed: false, text: 'Action needed: 2 high or critical dev-tool advisories.' });
    expect(advisoryVerdict({}, {})).toEqual({ failed: false, text: '' });
  });
});
