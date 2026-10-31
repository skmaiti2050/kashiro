import { lockedTokens, passesGuard, type GuardVerdict } from './llm/guard';
import type { Status } from './sessionTypes';
import type { Candidate, Paragraph, Span } from './types';

const sentenceKey = (paraId: number, span: Span) => `${paraId}:${span.start}-${span.end}`;
/** A sentenceKey: "3:12-40". */
const SENTENCE_KEY = /^(\d+):(\d+)-(\d+)$/;
const parseSentenceKey = (key: string): [number, Span] => {
  const [, paraId, start, end] = SENTENCE_KEY.exec(key)!.map(Number);
  return [paraId, { start, end }];
};

/** The id of the AI rewrite of a sentence. */
export const rewriteId = (paraId: number, span: Span) => `llm:${sentenceKey(paraId, span)}`;

/** The AI rewrite of the sentence at `span` of `p`: a review candidate replacing the whole sentence. */
const rewriteCandidate = (p: Paragraph, span: Span, rewrite: string): Candidate => ({
  id: rewriteId(p.id, span),
  paraId: p.id,
  span: { ...span },
  original: p.text.slice(span.start, span.end),
  replacements: [rewrite],
  kind: 'Rewrite',
  message: 'Suggested rewrite of the sentence. Check the meaning before accepting.',
  source: 'llm',
});

/** Why a pending AI rewrite left the queue: an edit in its sentence was accepted or undone after it was made. */
export const REWRITE_OUT_OF_DATE = 'the sentence changed after the AI suggestion was made';

/** What the AI rewrites need from their CheckSession. */
export interface RewriteHost {
  paragraph(paraId: number): Paragraph | undefined;
  /** The sentence at `span` as it reads now (accepted edits applied), or null when an edit crosses its edge. */
  sentenceNow(paraId: number, span: Span): string | null;
  candidate(id: string): Candidate | undefined;
  status(id: string): Status | undefined;
  /** The user rejected it (not a withdrawal or an unplaceable edit). */
  rejectedByUser(id: string): boolean;
  /** Adds a pending review candidate. */
  addCandidate(c: Candidate): void;
  /** Puts `c` in place of the withdrawn candidate with its id, pending again. */
  replaceWithdrawn(c: Candidate): void;
  /** Takes a pending candidate out of the review, as superseded with `reason`. */
  withdraw(id: string, reason: string): void;
  /** Applies one candidate through accept's checks (card guard, tracked changes). */
  applyOne(id: string): void;
  /** A new batch id, and `id` put in it, for undoBatch. */
  newBatch(): string;
  joinBatch(id: string, batchId: string): void;
  accept(id: string): void;
  reject(id: string): void;
}

/**
 * The LLM helper's part of a CheckSession: which sentences it was sent (and their text then), the rewrites that
 * passed the guard, "Accept all", carrying them through a re-check, and withdrawing a pending rewrite once its
 * sentence changes (applying it then would drop the user's edit).
 */
export class HelperRewrites {
  /** Sentences already sent to the LLM helper: sentenceKey(paraId, span) → the text it was sent. */
  private readonly sent = new Map<string, string>();
  /**
   * LLM rewrites that passed the meaning-drift guard: id → the sentence text they rewrite now. One kept by keepApplied
   * passed it when the user accepted it, in an earlier check, against that sentence with a fix since gone.
   */
  private readonly guarded = new Map<string, string>();
  /** Rewrites withdrawStale took out of the review (their sentence may be asked about again). */
  private readonly withdrawn = new Set<string>();

  constructor(private readonly host: RewriteHost) {}

  sentToHelper(paraId: number, span: Span): boolean {
    return this.sent.has(sentenceKey(paraId, span));
  }

  /** The candidate is an AI rewrite that passed the guard. */
  isGuarded(id: string): boolean {
    return this.guarded.has(id);
  }

  /**
   * Records that the LLM helper saw the sentence at `span` (so it is not sent again) and runs the
   * meaning-drift guard on `rewrite` against the text sent (the sentence with its accepted edits).
   * A passing rewrite becomes a pending review-tier candidate (source 'llm', kind 'Rewrite') replacing
   * the whole original sentence. Returns the guard's verdict, or null when `rewrite` is null.
   * `sentText` is the text the helper was sent: when the sentence no longer reads that way (an edit was
   * accepted or undone while the helper worked), the answer is stale. It is dropped and 'stale' returned,
   * and the sentence is not marked as sent, so it can be asked about again.
   */
  add(paraId: number, span: Span, rewrite: string | null, sentText?: string): GuardVerdict | 'stale' | null {
    const p = this.host.paragraph(paraId);
    if (!p) throw new Error(`unknown paragraph ${paraId}`);
    if (span.start < 0 || span.end > p.text.length || span.start >= span.end) {
      throw new Error(`span ${span.start}-${span.end} is not inside paragraph ${paraId}`);
    }
    const now = this.host.sentenceNow(paraId, span);
    if (sentText !== undefined && now !== sentText) return 'stale';
    this.sent.set(sentenceKey(paraId, span), now ?? '');
    if (rewrite === null) return null;
    if (now === null) throw new Error(`an accepted edit crosses the edge of sentence ${sentenceKey(paraId, span)}; it cannot be rewritten`);
    const verdict = passesGuard(now, rewrite, lockedTokens(now));
    if (!verdict.ok) return verdict;
    const id = rewriteId(paraId, span);
    const candidate = rewriteCandidate(p, span, rewrite);
    // Asked again after its suggestion was withdrawn: the new suggestion takes that id, pending again. Any other
    // state means the sentence is still sent, so it is never asked again (CheckSession keeps one rewrite per sentence).
    if (this.host.candidate(id) === undefined) this.host.addCandidate(candidate);
    else if (this.isWithdrawn(id)) {
      this.withdrawn.delete(id);
      this.host.replaceWithdrawn(candidate);
    } else throw new Error(`the sentence ${sentenceKey(paraId, span)} already has an AI suggestion`);
    this.guarded.set(id, now);
    return verdict;
  }

  /**
   * "Accept all helper suggestions": applies each pending AI rewrite in `candidateIds` with its own text, as one
   * batch that undoBatch takes back in one step. Each goes through the same checks as accept. Returns the batch id.
   */
  applyAll(candidateIds: string[]): string {
    if (candidateIds.length === 0) throw new Error('choose at least one AI suggestion to apply');
    for (const id of candidateIds) {
      if (!this.guarded.has(id) || this.host.status(id) !== 'pending') throw new Error(`${id} is not a pending AI suggestion`);
    }
    const batchId = this.host.newBatch();
    for (const id of candidateIds) {
      // One at a time, so a rewrite withdrawn by an earlier one in the list is skipped, never applied stale.
      if (this.host.status(id) !== 'pending') continue;
      this.host.applyOne(id);
      if (this.host.status(id) === 'applied') this.host.joinBatch(id, batchId);
    }
    return batchId;
  }

  /**
   * After a re-check (`before` is the previous check of the same document, `unchanged` maps its paragraph ids to
   * this check's): the AI answers on unchanged paragraphs come back. Each rewrite is added again through the
   * guard, then its accept or reject is replayed; sentences answered with nothing stay sent. Any whose sentence
   * now reads differently (a rule fix it included is gone) is dropped, unless it was applied (keepApplied).
   * Returns old candidate id → new id.
   */
  carryFrom(before: HelperRewrites, unchanged: Map<number, number>): Map<string, string> {
    const carried = new Map<string, string>();
    for (const [key, sent] of before.sent) {
      const [oldPara, span] = parseSentenceKey(key);
      const paraId = unchanged.get(oldPara);
      if (paraId === undefined) continue;
      const oldId = `llm:${key}`;
      if (this.host.sentenceNow(paraId, span) !== sent) {
        if (before.guarded.has(oldId) && before.host.status(oldId) === 'applied' && this.keepApplied(paraId, span, before.host.candidate(oldId)!)) {
          carried.set(oldId, rewriteId(paraId, span));
        }
        continue;
      }
      const rewritten = before.guarded.has(oldId) ? before.host.candidate(oldId)!.replacements[0] : null;
      const verdict = this.add(paraId, span, rewritten, sent);
      if (verdict !== null && verdict !== 'stale' && verdict.ok) carried.set(oldId, rewriteId(paraId, span));
    }
    for (const [oldId, newId] of carried) {
      if (this.host.status(newId) !== 'pending') continue;
      const status = before.host.status(oldId);
      if (status === 'applied') this.host.accept(newId);
      else if (status === 'rejected' && before.host.rejectedByUser(oldId)) this.host.reject(newId);
    }
    return carried;
  }

  /**
   * A rewrite the user applied, whose sentence lost a fix it was made over (its word added to the dictionary, #11):
   * dropping it would change the text without a word. Its paragraph is unchanged, so it replaces the same original
   * text as before and the output reads as it did; it is added as made, to be accepted again. False when an accepted
   * edit crosses the sentence's edge (it can no longer be placed), and it is dropped as before.
   */
  private keepApplied(paraId: number, span: Span, old: Candidate): boolean {
    const now = this.host.sentenceNow(paraId, span);
    if (now === null) return false;
    const candidate = rewriteCandidate(this.host.paragraph(paraId)!, span, old.replacements[0]);
    this.host.addCandidate(candidate);
    this.sent.set(sentenceKey(paraId, span), now);
    this.guarded.set(candidate.id, now);
    return true;
  }

  /** Withdrawn by withdrawStale: its sentence changed while it waited for review. */
  private isWithdrawn(id: string): boolean {
    return this.withdrawn.has(id) && this.host.status(id) === 'superseded';
  }

  /**
   * A pending AI rewrite was made for its sentence as it read then. Once an edit inside the sentence is accepted
   * or undone, applying it would silently drop that edit, so it is withdrawn (superseded, with the reason) and
   * the sentence can be asked about again.
   */
  withdrawStale(): void {
    for (const [id, sent] of this.guarded) {
      if (this.host.status(id) !== 'pending') continue;
      const c = this.host.candidate(id)!;
      if (this.host.sentenceNow(c.paraId, c.span) === sent) continue;
      this.host.withdraw(id, REWRITE_OUT_OF_DATE);
      this.withdrawn.add(id);
      this.sent.delete(sentenceKey(c.paraId, c.span));
    }
  }
}
