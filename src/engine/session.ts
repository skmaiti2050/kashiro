import { overlapsLocked } from './factLock';
import { buildDecisions, foldsUnderMore, NAMES_CARD_ID, OTHER_LANGUAGE_CARD_ID, TERMS_CARD_ID, type Decision } from './decisions';
import { checkTermMinRepeats, DEFAULT_TERM_MIN_REPEATS } from './terms';
import { tierOf, type TierContext } from './tiers';
import { EditLedger } from './editLedger';
import { prepareCheck } from './sessionSetup';
import { DEFAULT_DEPTH, upFrontCount, type ReviewDepth } from './depth';
import { countWords } from './words';
import { DEFAULT_MODULES, type ModuleSwitches } from './modules';
import { WORD_REWRITE_KINDS } from './wordFlags';
import { sentenceWithEdits } from './sentences';
import type { GuardVerdict } from './llm/guard';
import { HelperRewrites } from './sessionRewrites';
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
import type { Candidate, Paragraph, Span, Tier, Variant } from './types';

// Public paths stay `engine/session`; the types live in sessionTypes.ts.
export { TRACKED_CHANGE_REASON, type CheckOptions, type Edit, type LogEntry, type Outcome, type SessionDeps, type Status };

export { REWRITE_OUT_OF_DATE } from './sessionRewrites';

/** The cards answered by their own method, never by accept: card id → its name and method. */
const CARD_ACCEPT_METHODS = new Map([
  [NAMES_CARD_ID, { name: 'names and places card', method: 'acceptNames' }],
  [TERMS_CARD_ID, { name: 'terms card', method: 'acceptTerms' }],
  [OTHER_LANGUAGE_CARD_ID, { name: 'words in Indian languages card', method: 'acceptOtherLanguage' }],
]);

export class CheckSession {
  private readonly paras = new Map<number, Paragraph>();
  private readonly paraNumber = new Map<number, number>();
  private readonly cands = new Map<string, Candidate>();
  private readonly tiers = new Map<string, Tier>();
  private readonly ledger: EditLedger;
  private readonly userRejected = new Set<string>();
  private readonly unplaceable = new Map<string, string>();
  private readonly added: string[] = [];
  /** Lowercased words the user unticked on a card (names, terms, other languages): real typos, ranked as words. */
  private readonly typoWords = new Set<string>();
  /** The LLM helper's sentences and rewrites. */
  private readonly rewrites: HelperRewrites;
  /** Candidate id → the applyBatch it was applied by, while it stays applied. */
  private readonly batchOf = new Map<string, string>();
  private batchCount = 0;
  private readonly words: number;

  private constructor(
    paras: Paragraph[],
    readonly variant: Variant,
    readonly mixedVariant: boolean,
    /** True when the text's spelling did not choose the variant: it is the fallback ("default", not "detected"). */
    readonly variantFromFallback: boolean,
    private readonly ctx: TierContext,
    now: () => Date,
    private readonly linter: RulesLinter,
    private reviewDepth: ReviewDepth,
    private readonly termMinRepeats: number,
  ) {
    this.words = paras.reduce((n, p) => n + countWords(p.text), 0);
    this.ledger = new EditLedger(this.cands, now);
    paras.forEach((p, i) => {
      this.paras.set(p.id, p);
      this.paraNumber.set(p.id, i + 1);
    });
    this.rewrites = new HelperRewrites({
      paragraph: (paraId) => this.paras.get(paraId),
      sentenceNow: (paraId, span) => sentenceWithEdits(this.paras.get(paraId)!.text, span, this.acceptedEdits().filter((e) => e.paraId === paraId)),
      candidate: (id) => this.cands.get(id),
      status: (id) => this.ledger.status.get(id),
      rejectedByUser: (id) => this.userRejected.has(id),
      addCandidate: (c) => this.addCandidates([c]),
      replaceWithdrawn: (c) => {
        this.cands.set(c.id, c);
        // The id's earlier life may have been applied: its old text must not show in the outcome or the log.
        this.ledger.replacement.delete(c.id);
        this.ledger.record(c.id, 'pending', false);
      },
      withdraw: (id, reason) => this.ledger.record(id, 'superseded', false, reason),
      applyOne: (id) => this.applyMembers(id, [this.cands.get(id)!], 0),
      newBatch: () => `batch-${++this.batchCount}`,
      joinBatch: (id, batchId) => this.batchOf.set(id, batchId),
      accept: (id) => this.accept(id),
      reject: (id) => this.reject(id),
    });
  }

  static async start(paras: Paragraph[], opts: CheckOptions, deps: SessionDeps = {}): Promise<CheckSession> {
    const termMinRepeats = opts.termMinRepeats ?? DEFAULT_TERM_MIN_REPEATS;
    checkTermMinRepeats(termMinRepeats);
    const { linter, variant, mixedVariant, variantFromFallback, ctx, found } = await prepareCheck(paras, opts, deps);
    const now = deps.now ?? (() => new Date());
    const depth = opts.depth ?? DEFAULT_DEPTH;
    const session = new CheckSession(paras, variant, mixedVariant, variantFromFallback, ctx, now, linter, depth, termMinRepeats);
    session.addCandidates(found);
    session.autoApply();
    return session;
  }

  // ---- queries -------------------------------------------------------------

  candidates(): Candidate[] {
    return [...this.cands.values()];
  }

  /** The paragraphs as given to start(), in document order. */
  paragraphs(): Paragraph[] {
    return [...this.paras.values()].map((p) => ({ ...p }));
  }

  /** True once addRewrite recorded this sentence, whatever the helper answered. */
  sentToHelper(paraId: number, span: Span): boolean {
    return this.rewrites.sentToHelper(paraId, span);
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
      // Except guarded rewrites: they cover the whole sentence and the guard kept its locked text intact.
      fold: (c) =>
        !this.rewrites.isGuarded(c.id) && foldsUnderMore(c, this.ctx.locked.get(c.paraId), this.paras.get(c.paraId)?.text),
      typoWords: this.typoWords,
      paraText: this.ctx.paraText,
      // Inside an existing tracked change: can't be applied, so never in `top`.
      blocked: (c) => this.ledger.inTrackedChange.has(c.id),
      termMinRepeats: this.termMinRepeats,
      foreignSentences: this.ctx.foreignSentences,
      modules: this.modules,
    });
    const topSize = upFrontCount(this.reviewDepth, this.words);
    return { top: decisions.slice(0, topSize), more: [...decisions.slice(topSize), ...blocked] };
  }

  get depth(): ReviewDepth {
    return this.reviewDepth;
  }

  /** The optional modules this check ran with. */
  get modules(): ModuleSwitches {
    return { ...(this.ctx.modules ?? DEFAULT_MODULES) };
  }

  /** Changes how many decisions show up front. Statuses and tiers are untouched. */
  setDepth(depth: ReviewDepth): void {
    this.reviewDepth = depth;
  }

  /** True when the candidate overlaps a fact-locked span or an adapter-locked (tracked change) span. */
  touchesLocked(candidateId: string): boolean {
    const c = this.cands.get(candidateId);
    if (!c) throw new Error(`unknown candidate ${candidateId}`);
    return this.ledger.inTrackedChange.has(c.id) || overlapsLocked(c, this.ctx.locked.get(c.paraId));
  }

  /** Decisions in the default view (spec §10): the top of the ranking, sized by the review depth. */
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
      batch: this.ledger.status.get(c.id) === 'applied' ? this.batchOf.get(c.id) : undefined,
    }));
  }

  // ---- actions -------------------------------------------------------------

  /**
   * Applies replacement `replacementIndex` to every member. In a batch, each member gets its own
   * replacement text (so case is kept), and only when all members share that text (case-insensitive):
   * a flagged word with different suggestions in different places cannot be "fixed for all" by index.
   */
  accept(decisionId: string, replacementIndex = 0): void {
    this.applyMembers(decisionId, this.members(decisionId), replacementIndex);
  }

  /**
   * "Apply all" after the batch preview: applies replacement `replacementIndex` to `candidateIds` (default:
   * every member of the batch) as accept does, and groups them so undoBatch can take them back in one step.
   * Unchosen members stay pending. Returns the batch id (also on each member's Outcome.batch).
   */
  applyBatch(decisionId: string, candidateIds?: string[], replacementIndex = 0): string {
    const members = this.members(decisionId);
    const chosen = (candidateIds ?? members.map((c) => c.id)).map((id) => {
      const member = members.find((c) => c.id === id);
      if (!member) throw new Error(`${id} is not part of ${decisionId}`);
      return member;
    });
    if (chosen.length === 0) throw new Error(`choose at least one place of ${decisionId} to apply`);
    this.applyMembers(decisionId, chosen, replacementIndex);
    const batchId = `batch-${++this.batchCount}`;
    for (const c of chosen) if (this.ledger.status.get(c.id) === 'applied') this.batchOf.set(c.id, batchId);
    return batchId;
  }

  /** Undoes every edit of an applyBatch that is still applied (applied → rejected, as undo does). */
  undoBatch(batchId: string): void {
    const ids = [...this.batchOf].filter(([, b]) => b === batchId).map(([id]) => id);
    if (ids.length === 0) throw new Error(`unknown batch ${batchId}`);
    for (const id of ids) {
      this.batchOf.delete(id);
      if (this.ledger.status.get(id) === 'applied') this.undo(id);
    }
  }

  /** The one place accept and applyBatch apply edits, so both keep the card guard and the same-text check. */
  private applyMembers(decisionId: string, members: Candidate[], replacementIndex: number): void {
    // Replacing names or terms with dictionary words by index would damage them (spec §5).
    const card = CARD_ACCEPT_METHODS.get(decisionId);
    if (card) throw new Error(`the ${card.name} is answered with ${card.method}(keepAsTypos), not accept`);
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
    this.rewrites.withdrawStale(); // a pending AI rewrite of a sentence that now reads differently leaves
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
    await this.acceptCard('names', keepAsTypos);
  }

  /** Accepts the terms card (spec §5) the same way as acceptNames: terms join the dictionary, `keepAsTypos` split out. */
  async acceptTerms(keepAsTypos: string[]): Promise<void> {
    await this.acceptCard('terms', keepAsTypos);
  }

  /**
   * Accepts the words-in-Indian-languages card (spec §5) the same way as acceptNames: the Indian-language words
   * join the dictionary, `keepAsTypos` split out. So do the card's likely typos ("jion", near "join"), unless
   * they are in `tickedLikelyTypos` (the user ticked them explicitly): "Add all" never adds one.
   */
  async acceptOtherLanguage(keepAsTypos: string[], tickedLikelyTypos: string[] = []): Promise<void> {
    const ticked = new Set(tickedLikelyTypos.map((w) => w.toLowerCase()));
    await this.acceptCard('otherLanguage', keepAsTypos, (card) =>
      (card.likelyTypos ?? []).map(([word]) => word).filter((word) => !ticked.has(word)),
    );
  }

  /** `alsoTypos`: words of the card that split out whatever the caller passed in `keepAsTypos`. */
  private async acceptCard(
    kind: 'names' | 'terms' | 'otherLanguage',
    keepAsTypos: string[],
    alsoTypos: (card: Decision) => string[] = () => [],
  ): Promise<void> {
    const { top, more } = this.decisions();
    const card = [...top, ...more].find((d) => d.kind === kind);
    if (!card) throw new Error(`there is no ${kind} card to accept: none of its words are pending`);
    const typos = new Set([...keepAsTypos, ...alsoTypos(card)].map((w) => w.toLowerCase()));
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

  /** Words added with addToDictionary or by accepting a card, in order. */
  addedWords(): string[] {
    return [...this.added];
  }

  /** applied → rejected; rejected (by the user) → pending. */
  undo(candidateId: string): void {
    const s = this.ledger.status.get(candidateId);
    if (s === 'applied') {
      this.batchOf.delete(candidateId);
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
    // Either way the text, or a rewrite back in review, may no longer match what a pending rewrite was made for.
    this.rewrites.withdrawStale();
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

  /** The helper's answer for a sentence, through the meaning-drift guard; 'stale' when the sentence changed (see HelperRewrites.add). */
  addRewrite(paraId: number, span: Span, rewrite: string | null, sentText?: string): GuardVerdict | 'stale' | null {
    return this.rewrites.add(paraId, span, rewrite, sentText);
  }

  /** "Accept all helper suggestions", one undo step (see HelperRewrites.applyAll). Returns the batch id. */
  applyRewrites(candidateIds: string[]): string {
    return this.rewrites.applyAll(candidateIds);
  }

  /** After a re-check: the AI answers on unchanged paragraphs come back (see HelperRewrites.carryFrom). Old id → new id. */
  carryRewritesFrom(before: CheckSession, unchanged: Map<number, number>): Map<string, string> {
    return this.rewrites.carryFrom(before.rewrites, unchanged);
  }

  /** The adapter could not write this edit into the document: it leaves the output. */
  markUnplaceable(candidateId: string, reason: string): void {
    if (!this.cands.has(candidateId)) throw new Error(`unknown candidate ${candidateId}`);
    this.unplaceable.set(candidateId, reason);
    this.ledger.record(candidateId, 'rejected', this.ledger.autoApplied.has(candidateId), `unplaceable: ${reason}`);
    this.ledger.restoreSuperseded(candidateId);
    this.rewrites.withdrawStale();
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
