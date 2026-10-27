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
  /** Pending rule fixes withdrawCovered took out of the review → id of the edit that covers them. */
  private readonly coveredBy = new Map<string, string>();
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

  /** True while withdrawCovered holds `id` out of the review, under an edit the user applied. */
  isCovered(id: string): boolean {
    return this.status.get(id) === 'superseded' && this.coveredBy.has(id);
  }

  /** For an applied edit that a later edit superseded: that later edit's id, while it is still applied. */
  appliedOver(id: string): string | undefined {
    const by = this.supersededBy.get(id);
    return this.status.get(id) === 'superseded' && by !== undefined && this.status.get(by) === 'applied' ? by : undefined;
  }

  /** The edit the user applied (not an auto-fix) that overlaps `c`, if any. */
  userEditOver(c: Candidate): Candidate | undefined {
    return this.clashing(c).find((o) => !this.autoApplied.has(o.id));
  }

  /**
   * A pending rule fix inside an edit the user applied (an AI rewrite, another card) was made for the text that
   * edit replaced: applying it would supersede the edit and change words outside its own span (final F13 review
   * I-2). It leaves the review, as superseded, while such an edit covers it, and comes back pending once none does.
   * AI rewrites are left to HelperRewrites.withdrawStale; an auto-fix still yields to a newer edit, as before.
   */
  withdrawCovered(): void {
    const userEdits = [...this.cands.values()].filter((o) => this.status.get(o.id) === 'applied' && !this.autoApplied.has(o.id));
    const editOver = (c: Candidate) => userEdits.find((o) => o.id !== c.id && o.paraId === c.paraId && overlaps(o.span, c.span));
    for (const c of this.cands.values()) {
      if (c.source === 'llm') continue;
      const status = this.status.get(c.id);
      const withdrawnBy = status === 'superseded' ? this.coveredBy.get(c.id) : undefined;
      if (status !== 'pending' && withdrawnBy === undefined) continue;
      const by = editOver(c);
      if (by && by.id !== withdrawnBy) {
        this.coveredBy.set(c.id, by.id);
        this.record(c.id, 'superseded', false, `superseded by ${by.id}`);
      } else if (!by && withdrawnBy !== undefined) {
        this.coveredBy.delete(c.id);
        this.record(c.id, 'pending', false, `restored after ${withdrawnBy} was removed`);
      }
    }
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
