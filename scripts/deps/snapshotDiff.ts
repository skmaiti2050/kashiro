// What changed between two snapshots, for upgrade-report.md (Task S8).
import type { HarperSnapshot, SnapshotDoc, SnapshotFlag } from './harperSnapshot';
import { compareText } from './licences';

/** Examples shown per kind and category in the report. */
const EXAMPLES_PER_KIND = 3;

export interface FlagChange {
  docId: string;
  before?: SnapshotFlag;
  after?: SnapshotFlag;
}

export interface HarperDiff {
  added: FlagChange[];
  removed: FlagChange[];
  /** Same document, kind and span; different message, suggestions or text. */
  changed: FlagChange[];
  /** Distinct message rewordings across all changed flags, most frequent first. */
  messageChanges: { before: string; after: string; count: number }[];
  variantChanges: string[];
  /** Documents whose input file changed (not a Harper change) or that appear on one side only. */
  documentChanges: string[];
  harperVersion: { before: string; after: string };
}

const allDocs = (snapshot: HarperSnapshot): SnapshotDoc[] => [...snapshot.reference, ...snapshot.samples, ...snapshot.probes];
const flagKey = (f: SnapshotFlag) => `${f.para}:${f.start}:${f.end}:${f.kind}`;
const sameFlag = (a: SnapshotFlag, b: SnapshotFlag) => JSON.stringify(a) === JSON.stringify(b);

export function diffHarperSnapshots(before: HarperSnapshot, after: HarperSnapshot): HarperDiff {
  const diff: HarperDiff = {
    added: [],
    removed: [],
    changed: [],
    messageChanges: [],
    variantChanges: [],
    documentChanges: [],
    harperVersion: { before: before.harper, after: after.harper },
  };
  const beforeDocs = new Map(allDocs(before).map((d) => [d.id, d]));
  const afterDocs = new Map(allDocs(after).map((d) => [d.id, d]));
  for (const id of beforeDocs.keys()) if (!afterDocs.has(id)) diff.documentChanges.push(`${id}: removed`);
  for (const [id, newDoc] of afterDocs) {
    const oldDoc = beforeDocs.get(id);
    if (!oldDoc) {
      diff.documentChanges.push(`${id}: added`);
      continue;
    }
    if (oldDoc.sha256 !== newDoc.sha256) diff.documentChanges.push(`${id}: input file changed`);
    if (oldDoc.variant !== newDoc.variant) diff.variantChanges.push(`${id}: ${oldDoc.variant} -> ${newDoc.variant}`);
    diffFlags(id, oldDoc.flags, newDoc.flags, diff);
  }
  diff.messageChanges = countMessageChanges(diff.changed);
  return diff;
}

/** Flags are matched by span and kind; a span holding two flags of one kind is matched in order. */
function diffFlags(docId: string, oldFlags: SnapshotFlag[], newFlags: SnapshotFlag[], diff: HarperDiff): void {
  const unmatched = new Map<string, SnapshotFlag[]>();
  for (const f of oldFlags) unmatched.set(flagKey(f), [...(unmatched.get(flagKey(f)) ?? []), f]);
  for (const f of newFlags) {
    const old = unmatched.get(flagKey(f))?.shift();
    if (!old) diff.added.push({ docId, after: f });
    else if (!sameFlag(old, f)) diff.changed.push({ docId, before: old, after: f });
  }
  for (const rest of unmatched.values()) for (const f of rest) diff.removed.push({ docId, before: f });
}

function countMessageChanges(changed: FlagChange[]): HarperDiff['messageChanges'] {
  const counts = new Map<string, { before: string; after: string; count: number }>();
  for (const { before, after } of changed) {
    if (!before?.message || !after?.message || before.message === after.message) continue;
    const key = `${before.message}\0${after.message}`;
    const entry = counts.get(key) ?? { before: before.message, after: after.message, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || compareText(a.before, b.before));
}

const describeFlag = (f: SnapshotFlag) =>
  f.hash ? `${f.kind} at ${f.para}:${f.start}-${f.end} (hash ${f.hash})` : `"${f.excerpt}": ${f.message} [${(f.suggestions ?? []).join(' | ')}]`;

export function harperDiffMarkdown(diff: HarperDiff): string {
  const { added, removed, changed } = diff;
  const lines: string[] = [];
  if (diff.harperVersion.before !== diff.harperVersion.after) lines.push(`harper.js ${diff.harperVersion.before} -> ${diff.harperVersion.after}`, '');
  if (!added.length && !removed.length && !changed.length && !diff.variantChanges.length && !diff.documentChanges.length) {
    return `${lines.join('\n')}No changes in Harper flags.\n`;
  }
  const kinds = [...new Set([...added, ...removed, ...changed].map((c) => (c.after ?? c.before)!.kind))].sort(compareText);
  const ofKind = (list: FlagChange[], kind: string) => list.filter((c) => (c.after ?? c.before)!.kind === kind);
  lines.push('| Kind | Added | Removed | Changed |', '|---|---|---|---|');
  for (const kind of kinds) lines.push(`| ${kind} | ${ofKind(added, kind).length} | ${ofKind(removed, kind).length} | ${ofKind(changed, kind).length} |`);
  lines.push('');
  if (diff.messageChanges.length) {
    lines.push('Message text changes:', '');
    for (const m of diff.messageChanges) lines.push(`- \`${m.before}\` -> \`${m.after}\` (${m.count})`);
    lines.push('');
  }
  for (const [title, list] of [['Added', added], ['Removed', removed], ['Changed (suggestions, text or message)', changed]] as const) {
    if (!list.length) continue;
    lines.push(`${title}, up to ${EXAMPLES_PER_KIND} per kind:`, '');
    for (const kind of kinds) {
      for (const c of ofKind(list, kind).slice(0, EXAMPLES_PER_KIND)) {
        const text = c.before && c.after ? `${describeFlag(c.before)} -> ${describeFlag(c.after)}` : describeFlag((c.after ?? c.before)!);
        lines.push(`- ${c.docId}: ${text}`);
      }
    }
    lines.push('');
  }
  for (const [title, list] of [['Variant changes', diff.variantChanges], ['Document changes', diff.documentChanges]] as const) {
    if (list.length) lines.push(`${title}:`, '', ...list.map((l) => `- ${l}`), '');
  }
  return `${lines.join('\n')}`;
}

/** Leaf-by-leaf differences of two JSON values, as "path: before -> after" lines. */
export function diffJson(before: unknown, after: unknown, path = ''): string[] {
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (isObject(before) && isObject(after)) {
    const lines: string[] = [];
    for (const key of Object.keys(before)) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in after)) lines.push(`${childPath}: removed (was ${JSON.stringify(before[key])})`);
      else lines.push(...diffJson(before[key], after[key], childPath));
    }
    for (const key of Object.keys(after)) {
      if (!(key in before)) lines.push(`${path ? `${path}.${key}` : key}: added ${JSON.stringify(after[key])}`);
    }
    return lines;
  }
  const [a, b] = [JSON.stringify(before), JSON.stringify(after)];
  return a === b ? [] : [`${path}: ${a} -> ${b}`];
}
