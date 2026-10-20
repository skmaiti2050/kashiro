import { overlapsLocked } from './factLock';
import { buildDecisions, foldsUnderMore, NAMES_CARD_ID, type Decision } from './decisions';
import { tierOf, type TierContext } from './tiers';
import { EditLedger } from './editLedger';
import { prepareCheck } from './sessionSetup';
import { WORD_REWRITE_KINDS } from './wordFlags';
import {
  byPosition,
  overlaps,
  TRACKED_CHANGE_REASON,
  type CheckOptions,
  type Edit,
  type LogEntry,
  type Outcome,
  type SessionDeps,
  type Status,
} from './sessionTypes';
import type { RulesLinter } from './linter';
import type { Candidate, Paragraph, Tier, Variant } from './types';

// Public paths stay `engine/session`; the types live in sessionTypes.ts.
export { TRACKED_CHANGE_REASON, type CheckOptions, type Edit, type LogEntry, type Outcome, type SessionDeps, type Status };

const TOP = 10;


export class CheckSession {
  private readonly paras = new Map<number, Paragraph>();
  private readonly paraNumber = new Map<number, number>();
  private readonly cands = new Map<string, Candidate>();
  private readonly tiers = new Map<string, Tier>();
  private readonly ledger: EditLedger;
  private readonly userRejected = new Set<string>();
  private readonly unplaceable = new Map<string, string>();
  private readonly added: string[] = [];
  /** Lowercased words the user unticked on the names card: real typos, ranked as words. */
  private readonly typoWords = new Set<string>();

  private constructor(
    paras: Paragraph[],
    readonly variant: Variant,
    readonly mixedVariant: boolean,
    private readonly ctx: TierContext,
    now: () => Date,
    private readonly linter: RulesLinter,
  ) {
    this.ledger = new EditLedger(this.cands, now);
    paras.forEach((p, i) => {
      this.paras.set(p.id, p);
      this.paraNumber.set(p.id, i + 1);
    });
  }

  static async start(paras: Paragraph[], opts: CheckOptions, deps: SessionDeps = {}): Promise<CheckSession> {
    const { linter, variant, mixedVariant, ctx, found } = await prepareCheck(paras, opts, deps);
    const session = new CheckSession(paras, variant, mixedVariant, ctx, deps.now ?? (() => new Date()), linter);
    session.addCandidates(found);
    session.autoApply();
    return session;
  }

  // ---- queries -------------------------------------------------------------

  candidates(): Candidate[] {
    return [...this.cands.values()];
  }

  tier(id: string): Tier {
    const t = this.tiers.get(id);
    if (!t) throw new Error(`unknown candidate ${id}`);
    return t;
  }

  decisions(): { top: Decision[]; more: Decision[] } {
    const pending: Candidate[] = [];
    const tiers = new Map<string, Tier>();
    for (const c of this.cands.values()) {
      if (this.ledger.status.get(c.id) !== 'pending' || this.unplaceable.has(c.id)) continue;
      const t = this.tiers.get(c.id)!;
      if (t === 'hidden') continue;
      pending.push(c);
      // A safe candidate is only pending after an undo/restore: offer it for review.
      tiers.set(c.id, t === 'safe' ? 'review' : t);
    }
    const { decisions, blocked } = buildDecisions(pending, tiers, {
      // Candidates on fact-locked spans (names, numbers, quotes…) are demoted: ranked last, never dropped.
      fold: (c) => foldsUnderMore(c, this.ctx.locked.get(c.paraId), this.paras.get(c.paraId)?.text),
      typoWords: this.typoWords,
      paraText: this.ctx.paraText,
      // Inside an existing tracked change: can't be applied, so never in `top`.
      blocked: (c) => this.ledger.inTrackedChange.has(c.id),
    });
    return { top: decisions.slice(0, TOP), more: [...decisions.slice(TOP), ...blocked] };
  }

  /** True when the candidate overlaps a fact-locked span or an adapter-locked (tracked change) span. */
  touchesLocked(candidateId: string): boolean {
    const c = this.cands.get(candidateId);
    if (!c) throw new Error(`unknown candidate ${candidateId}`);
    return this.ledger.inTrackedChange.has(c.id) || overlapsLocked(c, this.ctx.locked.get(c.paraId));
  }

  /** Decisions in the default view (spec §10): the top of the ranking (at most TOP). */
  decisionCount(): number {
    return this.decisions().top.length;
  }

  /**
   * Every ranked pending decision (top and more), excluding only candidates that cannot be applied
   * (inside an existing tracked change). The trust suite's review budget uses this stricter count,
   * so a long tail under "more" cannot pass by being capped out of view.
   */
  rankedDecisionCount(): number {
    const { top, more } = this.decisions();
    // The names card may hold tracked-change names too; it is blocked only when all of it is.
    return top.length + more.filter((d) => !d.candidateIds.every((id) => this.ledger.inTrackedChange.has(id))).length;
  }

  log(): LogEntry[] {
    return this.ledger.log();
  }

  acceptedEdits(): Edit[] {
    const out: Edit[] = [];
    for (const c of this.cands.values()) {
      if (this.ledger.status.get(c.id) !== 'applied') continue;
      out.push({ paraId: c.paraId, span: { ...c.span }, replacement: this.ledger.replacement.get(c.id)! });
    }
    return out.sort(byPosition);
  }

  outputText(paraId: number): string {
    const p = this.paras.get(paraId);
    if (!p) throw new Error(`unknown paragraph ${paraId}`);
    let text = p.text;
    const edits = this.acceptedEdits().filter((e) => e.paraId === paraId);
    for (let i = edits.length - 1; i >= 0; i--) {
      const { span, replacement } = edits[i];
      text = text.slice(0, span.start) + replacement + text.slice(span.end);
    }
    return text;
  }

  /** Final state of every candidate, in document order. */
  outcomes(): Outcome[] {
    return [...this.cands.values()].sort(byPosition).map((c) => ({
      candidate: c,
      paragraphNumber: this.paraNumber.get(c.paraId) ?? c.paraId + 1,
      status: this.ledger.status.get(c.id)!,
      auto: this.ledger.autoApplied.has(c.id),
      replacement: this.ledger.replacement.get(c.id) ?? c.replacements[0],
      reason: this.ledger.reasons.get(c.id),
      unplaceable: this.unplaceable.get(c.id),
    }));
  }

  // ---- actions -------------------------------------------------------------

  /**
   * Applies replacement `replacementIndex` to every member. In a batch, each member gets its own
   * replacement text (so case is kept), and only when all members share that text (case-insensitive):
   * a flagged word with different suggestions in different places cannot be "fixed for all" by index.
   */
  accept(decisionId: string, replacementIndex = 0): void {
    // Replacing names with dictionary words by index would damage them (spec §5).
    if (decisionId === NAMES_CARD_ID) throw new Error('the names card is answered with acceptNames(keepAsTypos), not accept');
    const members = this.members(decisionId);
    for (const c of members) {
      if (c.replacements[replacementIndex] === undefined) {
        throw new Error(`candidate ${c.id} has no replacement at index ${replacementIndex}`);
      }
    }
    const texts = new Set(members.map((c) => c.replacements[replacementIndex].toLowerCase()));
    if (texts.size > 1) {
      throw new Error(
        `${decisionId}: members have different replacements at index ${replacementIndex} (${[...texts].join(' / ')}); accept them one by one`,
      );
    }
    for (const c of members) {
      if (this.ledger.inTrackedChange.has(c.id)) {
        this.ledger.record(c.id, 'pending', false, TRACKED_CHANGE_REASON);
        continue;
      }
      this.ledger.apply(c, c.replacements[replacementIndex], false);
    }
  }

  reject(decisionId: string): void {
    for (const c of this.members(decisionId)) {
      this.userRejected.add(c.id);
      this.ledger.record(c.id, 'rejected', false);
    }
  }

  /** "Ignore all": rejects every member of the decision. */
  ignoreAll(decisionId: string): void {
    this.reject(decisionId);
  }

  /**
   * "Add to dictionary" for a flagged word (Spelling/Typo): adds it to this session's dictionary and the
   * linter, rejects the decision's members, and rejects every other pending flag of the same word.
   */
  async addToDictionary(decisionId: string): Promise<void> {
    const members = this.members(decisionId);
    const first = members[0];
    if (!WORD_REWRITE_KINDS.has(first.kind) || members.some((c) => c.original.toLowerCase() !== first.original.toLowerCase())) {
      throw new Error(`${decisionId} is not a word flag (Spelling/Typo of one word)`);
    }
    await this.addWord(first.original);
  }

  /**
   * Accepts the names card (spec §5): every distinct name on it goes into the dictionary (as
   * addToDictionary does), except the words in `keepAsTypos` (any case), which leave the card and
   * become their own per-word decisions so the user can fix them.
   */
  async acceptNames(keepAsTypos: string[]): Promise<void> {
    const { top, more } = this.decisions();
    const card = [...top, ...more].find((d) => d.kind === 'names');
    if (!card) throw new Error('there is no names card to accept: no unknown names are pending');
    const typos = new Set(keepAsTypos.map((w) => w.toLowerCase()));
    const words = new Map<string, string>(); // lowercased → first spelling seen
    for (const id of card.candidateIds) {
      const original = this.cands.get(id)!.original;
      if (!words.has(original.toLowerCase())) words.set(original.toLowerCase(), original);
    }
    for (const [lower, word] of words) {
      if (typos.has(lower)) this.typoWords.add(lower);
      else await this.addWord(word);
    }
  }

  /** Adds `word` to the linter and rejects every pending Spelling/Typo flag of it. */
  private async addWord(word: string): Promise<void> {
    await this.linter.addWords([word]);
    this.added.push(word);
    const reason = `"${word}" added to dictionary`;
    for (const c of this.cands.values()) {
      if (this.ledger.status.get(c.id) !== 'pending' || !WORD_REWRITE_KINDS.has(c.kind)) continue;
      if (c.original.toLowerCase() !== word.toLowerCase()) continue;
      this.userRejected.add(c.id);
      this.ledger.record(c.id, 'rejected', false, reason);
    }
  }

  /** Words added with addToDictionary or acceptNames, in order. */
  addedWords(): string[] {
    return [...this.added];
  }

  /** applied → rejected; rejected (by the user) → pending. */
  undo(candidateId: string): void {
    const s = this.ledger.status.get(candidateId);
    if (s === 'applied') {
      this.ledger.autoApplied.delete(candidateId);
      this.userRejected.add(candidateId);
      this.ledger.record(candidateId, 'rejected', false, 'undone');
      this.ledger.restoreSuperseded(candidateId);
    } else if (s === 'rejected' && this.userRejected.has(candidateId)) {
      this.userRejected.delete(candidateId);
      this.ledger.record(candidateId, 'pending', false);
    } else {
      throw new Error(`cannot undo ${candidateId} (${s ?? 'unknown'})`);
    }
  }

  /** Adds candidates as pending (never auto-applied). Ids already present are ignored. */
  addCandidates(cs: Candidate[]): void {
    for (const c of cs) {
      if (this.cands.has(c.id)) continue;
      this.cands.set(c.id, c);
      this.tiers.set(c.id, tierOf(c, this.ctx));
      this.ledger.status.set(c.id, 'pending');
      const adapterLocked = this.paras.get(c.paraId)?.locked;
      if (adapterLocked?.some((s) => overlaps(c.span, s))) {
        this.ledger.inTrackedChange.add(c.id);
        this.ledger.reasons.set(c.id, TRACKED_CHANGE_REASON);
        if (this.tiers.get(c.id) === 'safe') this.tiers.set(c.id, 'review');
      }
    }
  }

  /** The adapter could not write this edit into the document: it leaves the output. */
  markUnplaceable(candidateId: string, reason: string): void {
    if (!this.cands.has(candidateId)) throw new Error(`unknown candidate ${candidateId}`);
    this.unplaceable.set(candidateId, reason);
    this.ledger.record(candidateId, 'rejected', this.ledger.autoApplied.has(candidateId), `unplaceable: ${reason}`);
    this.ledger.restoreSuperseded(candidateId);
  }

  // ---- internals -----------------------------------------------------------

  private autoApply(): void {
    const safe = [...this.cands.values()].filter((c) => this.tiers.get(c.id) === 'safe').sort(byPosition);
    for (const c of safe) {
      if (this.ledger.clashing(c).length) {
        this.tiers.set(c.id, 'review');
        continue;
      }
      this.ledger.apply(c, c.replacements[0], true);
    }
  }

  private members(decisionId: string): Candidate[] {
    const { top, more } = this.decisions();
    const d = [...top, ...more].find((x) => x.id === decisionId);
    if (d) return d.candidateIds.map((id) => this.cands.get(id)!);
    const c = this.cands.get(decisionId);
    if (c && this.ledger.status.get(c.id) === 'pending') return [c];
    throw new Error(`unknown or already decided: ${decisionId}`);
  }
}
