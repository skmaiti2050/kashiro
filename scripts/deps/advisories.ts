/**
 * npm advisories for deps:status (Task S8), in two groups. Production advisories (`npm audit --omit=dev`)
 * fail the run: that code ships. Dev-tool advisories (in the full `npm audit` only) don't ship, but they run
 * on the developer's machine during tests, so high and critical ones are "action needed" warnings.
 */
import { compareText } from './licences';
import type { NpmAudit } from './toolReports';

type Vulnerabilities = NpmAudit['vulnerabilities'];

const SERIOUS = new Set(['high', 'critical']);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const byName = (vulnerabilities: Vulnerabilities) => Object.entries(vulnerabilities).sort(([a], [b]) => compareText(a, b));

/** The advisories of the full audit that the production audit doesn't have: dev tools only. */
export function devOnlyVulnerabilities(full: NpmAudit, production: NpmAudit): Vulnerabilities {
  return Object.fromEntries(Object.entries(full.vulnerabilities).filter(([name]) => !(name in production.vulnerabilities)));
}

/** "Prototype pollution … (https://github.com/advisories/GHSA-…)" or "via tinypool" for an inherited one. */
function describeVia(via: Vulnerabilities[string]['via']): string {
  return via.map((v) => (typeof v === 'string' ? `via ${v}` : `${v.title} (${v.url})`)).join('; ');
}

export function advisoryLines(vulnerabilities: Vulnerabilities): string[] {
  return byName(vulnerabilities).map(([name, v]) => `- **${name}** (${v.severity}): ${describeVia(v.via)}`);
}

/** One warning per high or critical dev-tool advisory. */
export function devActionNeeded(dev: Vulnerabilities): string[] {
  return byName(dev)
    .filter(([, v]) => SERIOUS.has(v.severity))
    .map(([name, v]) => `action needed: dev tool ${name} (${v.severity}): ${describeVia(v.via)}`);
}

/** The advisory part of the deps:status headline; any production advisory fails the run. */
export function advisoryVerdict(production: Vulnerabilities, dev: Vulnerabilities): { failed: boolean; text: string } {
  const names = Object.keys(production).sort(compareText);
  const serious = devActionNeeded(dev).length;
  const parts = [
    names.length ? `FAILED: ${plural(names.length, 'production npm advisory', 'production npm advisories')} (${names.join(', ')}).` : '',
    serious ? `Action needed: ${plural(serious, 'high or critical dev-tool advisory', 'high or critical dev-tool advisories')}.` : '',
  ];
  return { failed: names.length > 0, text: parts.filter(Boolean).join(' ') };
}
