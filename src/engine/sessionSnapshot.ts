import { carryDecisions, userDecisions, type UserDecision } from './carryDecisions';
import type { ReviewDepth } from './depth';
import type { PresetId } from './presets';
import { CheckSession } from './session';
import type { CheckOptions, SessionDeps } from './sessionTypes';
import { sha256Hex } from './sha256';
import type { Paragraph, Variant } from './types';

/** Bumped when the format changes: a saved review of another version is not resumed. */
export const SNAPSHOT_VERSION = 2;

/**
 * One user decision, by its paragraph's position and the flag's kind and offsets there: no words at all. The
 * flagged text comes back from the paragraph itself once its hash matches.
 */
export interface SavedDecision {
  /** Index into SessionSnapshot.paragraphs. */
  paragraph: number;
  kind: string;
  start: number;
  end: number;
  status: 'applied' | 'rejected';
  /** For an applied edit only: the index of the replacement chosen in the flag's suggestions. */
  replacementIndex?: number;
}

/** What the review was looking at, beside the session itself (the controller holds these). */
export interface SnapshotView {
  preset: PresetId;
  variantOverride: Variant | null;
  /** Kinds dismissed with "This rule in this document". */
  documentIgnoredRules: string[];
}

/**
 * A review to resume later (Task S3). It never holds the document's words: paragraphs are SHA-256 hashes of
 * their text, and a decision is kind, offsets, status and a replacement index.
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
  /** Saved decisions that changed a flag's status when replayed (their paragraph and flag were found again). */
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
    decisions: userDecisions(session).filter(isReplayable).map((d) => ({
      paragraph: position.get(d.paraId)!,
      kind: d.kind,
      start: d.span.start,
      end: d.span.end,
      status: d.status,
      ...(d.status === 'applied' ? { replacementIndex: d.replacementIndex } : {}),
    })),
  };
}

/**
 * LLM rewrites are left out: the next check doesn't make them again, so there is nothing to replay them on,
 * and their text is a whole sentence. So is an applied edit whose text is not among the flag's suggestions.
 */
const isReplayable = (d: UserDecision) => d.source !== 'llm' && (d.status !== 'applied' || (d.replacementIndex ?? -1) >= 0);

/**
 * Checks `paras` afresh (with `opts`, at the snapshot's depth) and replays the saved decisions through
 * carryDecisions, only on paragraphs whose text hash matches: a changed paragraph is checked as new.
 * Nothing is applied that the user did not accept, and each accept is replayed once.
 */
export async function restore(paras: Paragraph[], snap: SessionSnapshot, opts: CheckOptions, deps: SessionDeps = {}): Promise<RestoredReview> {
  const session = await CheckSession.start(paras, { ...opts, depth: snap.depth }, deps);
  const hashes = await Promise.all(paras.map((p) => sha256Hex(p.text)));
  const unchanged = matchSavedParagraphs(snap.paragraphs, hashes, paras);
  const textOf = new Map(paras.map((p) => [p.id, p.text]));
  const decisions: UserDecision[] = [];
  snap.decisions.forEach((d, i) => {
    const paraId = unchanged.get(d.paragraph);
    if (paraId === undefined) return; // its paragraph changed: checked afresh
    decisions.push({
      candidateId: `saved-${i}`,
      paraId: d.paragraph,
      kind: d.kind,
      original: textOf.get(paraId)!.slice(d.start, d.end),
      span: { start: d.start, end: d.end },
      status: d.status,
      replacementIndex: d.replacementIndex,
      source: 'rules',
    });
  });
  const before = new Map(session.outcomes().map((o) => [o.candidate.id, o.status]));
  const carried = carryDecisions(decisions, session, unchanged);
  const after = new Map(session.outcomes().map((o) => [o.candidate.id, o.status]));
  const restored = [...carried.values()].filter((id) => before.get(id) !== after.get(id)).length;
  return { session, restored, rechecked: paras.length - unchanged.size };
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
