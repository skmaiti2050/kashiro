import type { CheckSession, Outcome } from './session';

const INVISIBLE = /[­​-‍⁠﻿]/g;

function cell(s: string): string {
  return s
    .replace(INVISIBLE, (ch) => `⟨U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟩`)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function statusLabel(o: Outcome): string {
  if (o.unplaceable !== undefined) return `unplaceable: ${o.unplaceable}`;
  if (o.status === 'applied') return o.auto ? 'auto' : 'accepted';
  if (o.status === 'pending') return `pending: ${o.reason}`;
  return o.status;
}

/** Markdown change report: every decided entry (and pending ones with a reason). */
export function exportReport(s: CheckSession, fileName: string): string {
  const all = s.outcomes();
  const count = (f: (o: Outcome) => boolean) => all.filter(f).length;
  const isUnplaceable = (o: Outcome) => o.unplaceable !== undefined;
  const pendingIds = new Set(
    Object.values(s.decisions()).flat().flatMap((d) => d.candidateIds),
  );

  const lines: string[] = [];
  lines.push(`# Kashiro report: ${fileName}`, '');
  lines.push(`- Variant: ${s.variant}`);
  if (s.mixedVariant) {
    lines.push(`- Warning: mixed spelling variants; some words follow another English variant.`);
  }
  lines.push(
    `- Auto: ${count((o) => !isUnplaceable(o) && o.status === 'applied' && o.auto)}`,
    `- Accepted: ${count((o) => !isUnplaceable(o) && o.status === 'applied' && !o.auto)}`,
    `- Rejected: ${count((o) => !isUnplaceable(o) && o.status === 'rejected')}`,
    `- Unplaceable: ${count(isUnplaceable)}`,
    `- Pending: ${count((o) => pendingIds.has(o.candidate.id))}`,
    '',
  );

  const rows = all.filter((o) => isUnplaceable(o) || o.status !== 'pending' || o.reason);
  if (rows.length === 0) {
    lines.push('No changes.');
    return lines.join('\n') + '\n';
  }
  lines.push('| # | paragraph | before | after | kind | status |', '|---|---|---|---|---|---|');
  rows.forEach((o, i) => {
    const after = o.replacement === undefined ? '' : o.replacement === '' ? '(deleted)' : o.replacement;
    lines.push(
      `| ${i + 1} | ${o.paragraphNumber} | ${cell(o.candidate.original)} | ${cell(after)} | ${cell(o.candidate.kind)} | ${cell(statusLabel(o))} |`,
    );
  });
  return lines.join('\n') + '\n';
}
