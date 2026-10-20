import { overlaps, TRACKED_CHANGE_REASON, type LogEntry, type Status } from './sessionTypes';
import type { Candidate } from './types';

/**
 * Per-candidate state of a session: status, chosen replacement, reasons, the log, and the rule that
 * an applied edit supersedes the applied edits it overlaps (and brings them back when it leaves).
 * `cands` is the session's candidate map, shared by reference.
 */
export class EditLedger {
  readonly status = new Map<string, Status>();
  readonly replacement = new Map<string, string>();
  readonly autoApplied = new Set<string>();
  readonly reasons = new Map<string, string>();
  /** Candidates overlapping an adapter-supplied Paragraph.locked span. */
  readonly inTrackedChange = new Set<string>();
  /** superseded candidate id → id of the edit that superseded it. */
  private readonly supersededBy = new Map<string, string>();
  private readonly entries: LogEntry[] = [];

  constructor(
    private readonly cands: ReadonlyMap<string, Candidate>,
    private readonly now: () => Date,
  ) {}

  log(): LogEntry[] {
    return [...this.entries];
  }

  /** Applied candidates that overlap `c`. */
  clashing(c: Candidate): Candidate[] {
    const out: Candidate[] = [];
    for (const o of this.cands.values()) {
      if (o.id !== c.id && o.paraId === c.paraId && this.status.get(o.id) === 'applied' && overlaps(o.span, c.span)) {
        out.push(o);
      }
    }
    return out;
  }

  apply(c: Candidate, replacement: string, auto: boolean): void {
    for (const old of this.clashing(c)) {
      this.supersededBy.set(old.id, c.id);
      this.record(old.id, 'superseded', false, `superseded by ${c.id}`);
    }
    this.replacement.set(c.id, replacement);
    if (auto) this.autoApplied.add(c.id);
    this.record(c.id, 'applied', auto);
  }

  /**
   * The edit `byId` left the output (undone or unplaceable): bring back what it superseded,
   * as applied when nothing applied clashes, else as pending.
   */
  restoreSuperseded(byId: string): void {
    for (const [oldId, by] of [...this.supersededBy]) {
      if (by !== byId) continue;
      this.supersededBy.delete(oldId);
      if (this.status.get(oldId) !== 'superseded') continue;
      const reason = `restored after ${byId} was removed`;
      if (this.clashing(this.cands.get(oldId)!).length === 0) {
        this.record(oldId, 'applied', this.autoApplied.has(oldId), reason);
      } else {
        this.autoApplied.delete(oldId);
        this.record(oldId, 'pending', false, reason);
      }
    }
  }

  record(candidateId: string, status: Status, auto: boolean, reason?: string): void {
    this.status.set(candidateId, status);
    if (reason) this.reasons.set(candidateId, reason);
    else if (this.inTrackedChange.has(candidateId)) this.reasons.set(candidateId, TRACKED_CHANGE_REASON);
    else this.reasons.delete(candidateId);
    const e: LogEntry = { candidateId, status, auto, at: this.now().toISOString() };
    if (reason) e.reason = reason;
    const replacement = this.replacement.get(candidateId);
    if (replacement !== undefined) e.replacement = replacement;
    this.entries.push(e);
  }
}
