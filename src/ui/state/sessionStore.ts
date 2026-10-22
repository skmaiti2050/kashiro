import { isRecord } from '@/engine/modules';
import { SNAPSHOT_VERSION, type SessionSnapshot } from '@/engine/sessionSnapshot';

/**
 * The saved-review files in the app's data folder (platform/sessions.ts: the Rust commands in
 * src-tauri/src/sessions.rs; an in-memory fake in tests). Keys are hex or uuid only.
 */
export interface SessionFiles {
  /** Writes atomically (temporary file, then rename). */
  save(key: string, json: string): Promise<void>;
  /** Null when there is no review under `key`. */
  load(key: string): Promise<string | null>;
  list(): Promise<{ key: string; json: string }[]>;
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

  /** Newest first. */
  async list(): Promise<RecentReview[]> {
    const recent: RecentReview[] = [];
    for (const { key, json } of await this.files.list()) {
      const review = readReview(json);
      if (review) recent.push({ key, name: review.name, path: review.path, updated: review.updated, made: review.made, left: review.left });
    }
    return recent.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  }

  delete(key: string): Promise<void> {
    return this.files.delete(key);
  }

  prune(retentionDays: number): Promise<void> {
    return this.files.prune(retentionDays);
  }
}

/** The review in `json`, or null when it is damaged or saved by another format version. */
function readReview(json: string): SavedReview | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null; // a damaged file: there is simply no review to resume
  }
  if (!isRecord(value) || !isRecord(value.snapshot)) return null;
  const { name, path, updated, made, left, text, snapshot } = value;
  const fieldsOk =
    typeof name === 'string' &&
    (typeof path === 'string' || path === null) &&
    typeof updated === 'string' &&
    typeof made === 'number' &&
    typeof left === 'number' &&
    (text === undefined || typeof text === 'string');
  const snapshotOk =
    snapshot.version === SNAPSHOT_VERSION &&
    Array.isArray(snapshot.paragraphs) &&
    Array.isArray(snapshot.decisions) &&
    Array.isArray(snapshot.documentIgnoredRules);
  return fieldsOk && snapshotOk ? (value as unknown as SavedReview) : null;
}
