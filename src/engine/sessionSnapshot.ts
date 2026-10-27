import { carryDecisions, findTwin, pairUniqueKeys, userDecisions, type UserDecision } from './carryDecisions';
import type { ReviewDepth } from './depth';
import type { PresetId } from './presets';
import { CheckSession } from './session';
import type { CheckOptions, SessionDeps } from './sessionTypes';
import { sha256Hex } from './sha256';
import type { Paragraph, Variant } from './types';

/** Bumped when the format changes: a saved review of another version is not resumed. */
export const SNAPSHOT_VERSION = 3;

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
  /**
   * For an applied edit only: replacementHash() of the replacement chosen. Not its index: a dictionary word or
   * a Harper upgrade can put another word at that index, and replaying it would make an edit nobody chose.
   */
  replacementHash?: string;
}

/** The first 16 hex digits of the SHA-256 of a replacement: enough to tell a flag's few suggestions apart. */
export const replacementHash = async (text: string): Promise<string> => (await sha256Hex(text)).slice(0, 16);

/** What the review was looking at, beside the session itself (the controller holds these). */
export interface SnapshotView {
  preset: PresetId;
  variantOverride: Variant | null;
  /** Kinds dismissed with "This rule in this document". */
  documentIgnoredRules: string[];
}

/**
 * A review to resume later (Task S3). It never holds the document's words: paragraphs are SHA-256 hashes of
 * their text, and a decision is kind, offsets, status and a short hash of the replacement chosen.
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
    decisions: await Promise.all(
      userDecisions(session)
        // No AI rewrite is saved, so neither is an edit under one: it is carried only with its rewrite.
        .filter((d) => d.source !== 'llm' && d.under === undefined)
        .map(async (d) => ({
          paragraph: position.get(d.paraId)!,
          kind: d.kind,
          start: d.span.start,
          end: d.span.end,
          status: d.status,
          ...(d.status === 'applied' ? { replacementHash: await replacementHash(d.replacement ?? '') } : {}),
        })),
    ),
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
  const textOf = new Map(paras.map((p) => [p.id, p.text]));
  const decisions: UserDecision[] = [];
  for (const [i, d] of snap.decisions.entries()) {
    const paraId = unchanged.get(d.paragraph);
    if (paraId === undefined) continue; // its paragraph changed: checked afresh
    const flag = { kind: d.kind, original: textOf.get(paraId)!.slice(d.start, d.end), span: { start: d.start, end: d.end } };
    const replacement = d.status === 'applied' ? await chosenReplacement(session, paraId, flag, d.replacementHash) : undefined;
    // The chosen word is no longer suggested: the flag comes back pending rather than take another word.
    if (d.status === 'applied' && replacement === undefined) continue;
    decisions.push({ candidateId: `saved-${i}`, paraId: d.paragraph, ...flag, status: d.status, replacement, source: 'rules' });
  }
  const before = new Map(session.outcomes().map((o) => [o.candidate.id, o.status]));
  const carried = carryDecisions(decisions, session, unchanged);
  const after = new Map(session.outcomes().map((o) => [o.candidate.id, o.status]));
  const restored = [...carried.values()].filter((id) => before.get(id) !== after.get(id)).length;
  return { session, restored, rechecked: paras.length - unchanged.size };
}

/** The suggestion of the flag's twin in the new check whose hash is `hash`, or undefined when none is. */
async function chosenReplacement(
  session: CheckSession,
  paraId: number,
  flag: Parameters<typeof findTwin>[2],
  hash: string | undefined,
): Promise<string | undefined> {
  const twin = findTwin(session, paraId, flag);
  if (!twin || hash === undefined) return undefined;
  for (const text of twin.replacements) if ((await replacementHash(text)) === hash) return text;
  return undefined;
}

/**
 * Saved paragraph index → the id of the paragraph with the same hash now. A hash found more than once, saved or
 * now, is never matched (see pairUniqueKeys), as in the re-check's matchUnchangedParagraphs.
 */
function matchSavedParagraphs(saved: string[], current: string[], paras: Paragraph[]): Map<number, number> {
  return new Map([...pairUniqueKeys(saved, current)].map(([i, j]) => [i, paras[j].id]));
}
