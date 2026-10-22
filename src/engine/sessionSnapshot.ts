import { carryDecisions, userDecisions, type UserDecision } from './carryDecisions';
import type { ReviewDepth } from './depth';
import type { PresetId } from './presets';
import { CheckSession } from './session';
import type { CheckOptions, SessionDeps } from './sessionTypes';
import { sha256Hex } from './sha256';
import type { Paragraph, Variant } from './types';

/** Bumped when the format changes: a saved review of another version is not resumed. */
export const SNAPSHOT_VERSION = 1;

/** One user decision, by its paragraph's position and the flag's identity in that paragraph. */
export interface SavedDecision {
  /** Index into SessionSnapshot.paragraphs. */
  paragraph: number;
  kind: string;
  original: string;
  start: number;
  end: number;
  status: 'applied' | 'rejected';
  /** The replacement chosen, for an applied edit only. */
  replacement?: string;
}

/** What the review was looking at, beside the session itself (the controller holds these). */
export interface SnapshotView {
  preset: PresetId;
  variantOverride: Variant | null;
  /** Kinds dismissed with "This rule in this document". */
  documentIgnoredRules: string[];
}

/**
 * A review to resume later (Task S3). It never holds the document: paragraphs are SHA-256 hashes of their
 * text, and a decision keeps only the flagged words and the replacement chosen.
 */
export interface SessionSnapshot extends SnapshotView {
  version: typeof SNAPSHOT_VERSION;
  depth: ReviewDepth;
  /** SHA-256 (hex) of each paragraph's text, in document order. */
  paragraphs: string[];
  decisions: SavedDecision[];
}

export interface RestoredReview {
  session: CheckSession;
  /** Saved decisions replayed (their paragraph and flag were found again). */
  restored: number;
  /** Paragraphs of the document with no unchanged twin in the snapshot: checked afresh. */
  rechecked: number;
}

export async function snapshot(session: CheckSession, view: SnapshotView): Promise<SessionSnapshot> {
  const paras = session.paragraphs();
  const position = new Map(paras.map((p, i) => [p.id, i]));
  return {
    version: SNAPSHOT_VERSION,
    preset: view.preset,
    variantOverride: view.variantOverride,
    documentIgnoredRules: [...view.documentIgnoredRules],
    depth: session.depth,
    paragraphs: await Promise.all(paras.map((p) => sha256Hex(p.text))),
    decisions: userDecisions(session).map((d) => ({
      paragraph: position.get(d.paraId)!,
      kind: d.kind,
      original: d.original,
      start: d.span.start,
      end: d.span.end,
      status: d.status,
      ...(d.status === 'applied' ? { replacement: d.replacement } : {}),
    })),
  };
}

/**
 * Checks `paras` afresh (with `opts`, at the snapshot's depth) and replays the saved decisions through
 * carryDecisions, only on paragraphs whose text hash matches: a changed paragraph is checked as new.
 * Nothing is applied that the user did not accept, and each accept is replayed once.
 */
export async function restore(paras: Paragraph[], snap: SessionSnapshot, opts: CheckOptions, deps: SessionDeps = {}): Promise<RestoredReview> {
  const session = await CheckSession.start(paras, { ...opts, depth: snap.depth }, deps);
  const hashes = await Promise.all(paras.map((p) => sha256Hex(p.text)));
  const unchanged = matchSavedParagraphs(snap.paragraphs, hashes, paras);
  const decisions: UserDecision[] = snap.decisions.map((d, i) => ({
    candidateId: `saved-${i}`,
    paraId: d.paragraph,
    kind: d.kind,
    original: d.original,
    span: { start: d.start, end: d.end },
    status: d.status,
    replacement: d.replacement,
  }));
  const carried = carryDecisions(decisions, session, unchanged);
  return { session, restored: carried.size, rechecked: paras.length - unchanged.size };
}

/**
 * Saved paragraph index → the id of the paragraph with the same hash now. Duplicated paragraphs pair up in
 * order (the first saved "A." with the first "A." now), as the re-check's matchUnchangedParagraphs does.
 */
function matchSavedParagraphs(saved: string[], current: string[], paras: Paragraph[]): Map<number, number> {
  const savedByHash = new Map<string, number[]>();
  saved.forEach((hash, i) => savedByHash.set(hash, [...(savedByHash.get(hash) ?? []), i]));
  const matched = new Map<number, number>();
  current.forEach((hash, i) => {
    const at = savedByHash.get(hash)?.shift();
    if (at !== undefined) matched.set(at, paras[i].id);
  });
  return matched;
}
