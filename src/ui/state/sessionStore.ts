import { DEPTHS } from '@/engine/depth';
import { isRecord } from '@/engine/modules';
import { PRESETS } from '@/engine/presets';
import { SNAPSHOT_VERSION, type SavedDecision, type SessionSnapshot } from '@/engine/sessionSnapshot';
import type { Variant } from '@/engine/types';

/**
 * The saved-review files in the app's data folder (platform/sessions.ts: the Rust commands in
 * src-tauri/src/sessions.rs; an in-memory fake in tests). Keys are hex or uuid only.
 */
export interface SessionFiles {
  /** Writes atomically (temporary file, then rename). */
  save(key: string, json: string): Promise<void>;
  /** Null when there is no review under `key`. */
  load(key: string): Promise<string | null>;
  /** Every review that could be read, and one line per file that could not ("<file>: <cause>"). */
  list(): Promise<{ sessions: { key: string; json: string }[]; problems: string[] }>;
  delete(key: string): Promise<void>;
  /** Deletes reviews last written more than `keepDays` days ago; 0 deletes them all. */
  prune(keepDays: number): Promise<void>;
}

/** One saved review. It never holds the file: only the pasted text, and only with the user's opt-in. */
export interface SavedReview {
  name: string;
  /** Null for pasted text. */
  path: string | null;
  /** When it was last saved (ISO 8601). */
  updated: string;
  /** Decisions made, and ranked decisions left, when it was saved. */
  made: number;
  left: number;
  /** Pasted text, kept only with "Keep pasted text for resuming" on. */
  text?: string;
  snapshot: SessionSnapshot;
}

/** A saved review and the key it is kept under. */
export interface KeyedReview {
  key: string;
  review: SavedReview;
}

/** A row of the Recent reviews list. */
export type RecentReview = Pick<SavedReview, 'name' | 'path' | 'updated' | 'made' | 'left'> & { key: string };

/** The saved reviews: JSON in, checked reviews out. A damaged or older-format file reads as no review. */
export class SessionStore {
  constructor(private readonly files: SessionFiles) {}

  save(key: string, review: SavedReview): Promise<void> {
    return this.files.save(key, JSON.stringify(review));
  }

  async load(key: string): Promise<SavedReview | null> {
    const json = await this.files.load(key);
    return json === null ? null : readReview(json);
  }

  /** Newest first, with the files that could not be read. */
  async list(): Promise<{ reviews: RecentReview[]; problems: string[] }> {
    const { sessions, problems } = await this.files.list();
    const reviews: RecentReview[] = [];
    for (const { key, json } of sessions) {
      const review = readReview(json);
      if (review) reviews.push({ key, name: review.name, path: review.path, updated: review.updated, made: review.made, left: review.left });
    }
    reviews.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
    return { reviews, problems };
  }

  delete(key: string): Promise<void> {
    return this.files.delete(key);
  }

  prune(retentionDays: number): Promise<void> {
    return this.files.prune(retentionDays);
  }
}

/** Exhaustive by type, so a new variant can't be forgotten here. */
const VARIANTS: Record<Variant, true> = { American: true, British: true, Australian: true, Canadian: true, Indian: true };

/**
 * The review in `json`, or null when it is damaged, saved by another format version, or names a goal, depth
 * or variant the app doesn't have: resuming writes those into the settings, so they must be real.
 */
function readReview(json: string): SavedReview | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null; // a damaged file: there is simply no review to resume
  }
  if (!isRecord(value) || !isRecord(value.snapshot)) return null;
  const { name, path, updated, made, left, text } = value;
  const fieldsOk =
    typeof name === 'string' &&
    (typeof path === 'string' || path === null) &&
    typeof updated === 'string' &&
    isCount(made) &&
    isCount(left) &&
    (text === undefined || typeof text === 'string');
  const snapshot = readSnapshot(value.snapshot);
  return fieldsOk && snapshot ? ({ ...value, snapshot } as unknown as SavedReview) : null;
}

function readSnapshot(snap: Record<string, unknown>): SessionSnapshot | null {
  const { version, preset, depth, variantOverride, paragraphs, decisions, documentIgnoredRules } = snap;
  if (version !== SNAPSHOT_VERSION || typeof preset !== 'string' || !Object.hasOwn(PRESETS, preset)) return null;
  if (typeof depth !== 'string' || !Object.hasOwn(DEPTHS, depth)) return null;
  if (variantOverride !== null && (typeof variantOverride !== 'string' || !Object.hasOwn(VARIANTS, variantOverride))) return null;
  if (!Array.isArray(paragraphs) || !paragraphs.every((p) => typeof p === 'string')) return null;
  if (!Array.isArray(decisions) || !Array.isArray(documentIgnoredRules)) return null;
  return {
    ...(snap as unknown as SessionSnapshot),
    documentIgnoredRules: documentIgnoredRules.filter((rule): rule is string => typeof rule === 'string'),
    decisions: decisions.filter((d): d is SavedDecision => isSavedDecision(d, paragraphs.length)),
  };
}

/** replacementHash(): 16 lowercase hex digits ("0123456789abcdef"). */
const REPLACEMENT_HASH = /^[0-9a-f]{16}$/;

const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

/** A well-formed decision on one of the `paragraphs` saved paragraphs; any other entry is dropped. */
function isSavedDecision(d: unknown, paragraphs: number): boolean {
  if (!isRecord(d) || typeof d.kind !== 'string') return false;
  const { paragraph, start, end, status, replacementHash } = d;
  if (!isCount(paragraph) || paragraph >= paragraphs || !isCount(start) || !isCount(end) || start > end) return false;
  if (status === 'rejected' || status === 'held') return true;
  return status === 'applied' && typeof replacementHash === 'string' && REPLACEMENT_HASH.test(replacementHash);
}
