/**
 * The Harper behaviour snapshot (Task S8): every flag Harper raises (kind, span, message, suggestions) on
 * the trust reference documents, on sample-pack fixtures and on short probe texts, with the variant the
 * engine picks for each. Written to deps/snapshots/harper.json and diffed by upgrade:check.
 *
 * Only short excerpts are stored, never whole texts. A source whose licence does not allow storing
 * excerpts (storeText false) keeps only kinds, offsets and a hash of each flag's text.
 */
import { createHash } from 'node:crypto';
import { detectVariant } from '../../src/engine/variant';
import type { RulesLinter } from '../../src/engine/linter';
import type { Variant } from '../../src/engine/types';
import { adapterFor } from '../../src/formats/registry';
import { compareText } from './licences';

/** Characters kept of a flagged text or a suggestion: an excerpt, not the sentence. */
const EXCERPT_LIMIT = 40;
/** Hex digits kept of a hash-only flag's hash: enough to see a change. */
const FLAG_HASH_LENGTH = 16;

export interface SnapshotInput {
  /** "reference/academic/groundwater-marathwada.md", "samples/fiction/austen-pride-and-prejudice.txt" */
  id: string;
  /** Picks the format adapter by extension. */
  fileName: string;
  bytes: Uint8Array;
  /** Where the text comes from (URL or repository folder), for attribution. */
  source: string;
  licence: string;
  /** False: keep offsets and a hash only (the licence does not cover storing excerpts). */
  storeText: boolean;
}

export interface SnapshotFlag {
  kind: string;
  para: number;
  start: number;
  end: number;
  excerpt?: string;
  message?: string;
  suggestions?: string[];
  /** Hash-only sources: sha256 of the flagged text, message and suggestions. */
  hash?: string;
}

export interface SnapshotDoc {
  id: string;
  source: string;
  licence: string;
  /** sha256 of the input file, so a changed input is not mistaken for a changed Harper. */
  sha256: string;
  variant: Variant;
  flags: SnapshotFlag[];
}

export interface HarperSnapshot {
  /** harper.js version that produced the snapshot. */
  harper: string;
  reference: SnapshotDoc[];
  samples: SnapshotDoc[];
  probes: SnapshotDoc[];
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** The first EXCERPT_LIMIT characters (code points, so an emoji is never cut in half). */
function excerpt(text: string): string {
  const chars = [...text];
  return chars.length > EXCERPT_LIMIT ? `${chars.slice(0, EXCERPT_LIMIT).join('')}…` : text;
}

/** Lints each input as the engine does: the variant it detects, then Harper's full rule set. */
export async function snapshotDocuments(linter: RulesLinter, inputs: SnapshotInput[]): Promise<SnapshotDoc[]> {
  const docs: SnapshotDoc[] = [];
  for (const input of inputs) {
    const adapter = adapterFor(input.fileName);
    if (!adapter) throw new Error(`No format adapter for ${input.fileName}; use .txt, .md or .docx.`);
    const { paras } = await adapter.read(input.bytes);
    const { variant } = await detectVariant(paras, 'American', { linter });
    if (linter.variant !== variant) await linter.setVariant(variant);
    const candidates = await linter.lintParagraphs(paras, adapter.language);
    const flags = candidates.map((c): SnapshotFlag => {
      const position = { kind: c.kind, para: c.paraId, start: c.span.start, end: c.span.end };
      if (!input.storeText) {
        const hash = sha256([c.original, c.message, ...c.replacements].join('\0')).slice(0, FLAG_HASH_LENGTH);
        return { ...position, hash };
      }
      return { ...position, excerpt: excerpt(c.original), message: c.message, suggestions: c.replacements.map(excerpt) };
    });
    flags.sort(
      (a, b) =>
        a.para - b.para ||
        a.start - b.start ||
        a.end - b.end ||
        compareText(a.kind, b.kind) ||
        compareText(a.message ?? a.hash ?? '', b.message ?? b.hash ?? ''),
    );
    const { id, source, licence } = input;
    docs.push({ id, source, licence, sha256: sha256(input.bytes), variant, flags });
  }
  return docs;
}

/** JSON with one flag per line, so a diff of the file reads flag by flag. */
export function formatHarperSnapshot(snapshot: HarperSnapshot): string {
  const formatDoc = ({ flags, ...head }: SnapshotDoc) => {
    const lines = flags.map((flag) => `      ${JSON.stringify(flag)}`).join(',\n');
    return `    ${JSON.stringify(head).slice(0, -1)},"flags":[\n${lines}\n    ]}`;
  };
  const section = (docs: SnapshotDoc[]) => (docs.length ? `[\n${docs.map(formatDoc).join(',\n')}\n  ]` : '[]');
  return [
    '{',
    `  "harper": ${JSON.stringify(snapshot.harper)},`,
    `  "reference": ${section(snapshot.reference)},`,
    `  "samples": ${section(snapshot.samples)},`,
    `  "probes": ${section(snapshot.probes)}`,
    '}',
    '',
  ].join('\n');
}
