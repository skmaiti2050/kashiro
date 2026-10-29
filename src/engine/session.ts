import { overlapsLocked } from './factLock';
import {
  buildDecisions,
  foldsUnderMore,
  NAMES_CARD_ID,
  OTHER_LANGUAGE_CARD_ID,
  SIMPLE_FIXES_ID,
  TERMS_CARD_ID,
  type Decision,
} from './decisions';
import { findAlignedParagraphs, isZeroClickChange } from './zeroClick';
import { editsChangingTokens } from './tokenGuard';
import { untickedByDefault } from './defaultTicks';
import { checkTermMinRepeats, DEFAULT_TERM_MIN_REPEATS } from './terms';
import { tierOf, type TierContext } from './tiers';
import { EditLedger } from './editLedger';
import { prepareCheck } from './sessionSetup';
import { DEFAULT_DEPTH, upFrontCount, type ReviewDepth } from './depth';
import { countWords } from './words';
import { DEFAULT_MODULES, type ModuleSwitches } from './modules';
import { doubledWord, WORD_REWRITE_KINDS } from './wordFlags';
import { dictionaryAccepts, dictionaryForm } from './dictionaryWords';
import { sentenceWithEdits } from './sentences';
import type { GuardVerdict } from './llm/guard';
import { HelperRewrites } from './sessionRewrites';
import {
  byPosition,
  overlaps,
  TRACKED_CHANGE_REASON,
  UNDONE_BEFORE_REASON,
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

/** Why a change made without a click was taken back by the token check (holdBackChangedTokens). */
const HELD_BACK_REASON = 'held back: it would change a word';

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
  /** Simple-fixes card members that are there only because the user added their kind in Settings: never ticked. */
  private readonly optedIn = new Set<string>();
  /** One-line paragraphs lined up with their neighbours (findAlignedParagraphs): their spaces are layout. */
  private readonly alignedParas: Set<number>;

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
    this.alignedParas = findAlignedParagraphs(paras);
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
    session.holdBackChangedTokens();
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
      onCommand: (c) => overlapsLocked(c, this.ctx.commandSpans?.get(c.paraId)),
      untickedOnCard: (fixes) =>
        untickedByDefault(fixes, {
          paraText: this.ctx.paraText ?? new Map(),
          optedIn: (c) => this.optedIn.has(c.id),
        }),
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

  /** True when the candidate is pending on the names, terms or Indian-language card: answered with that card's method, never accept. */
  onWordCard(candidateId: string): boolean {
    const { top, more } = this.decisions();
    return [...top, ...more].some((d) => CARD_ACCEPT_METHODS.has(d.id) && d.candidateIds.includes(candidateId));
  }

  /** For an edit the user applied and a later edit (an AI rewrite) superseded: that edit's id, while it stays applied. */
  appliedOver(candidateId: string): string | undefined {
    return this.ledger.appliedOver(candidateId);
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
    const { ownerId, members } = this.resolve(decisionId);
    this.applyMembers(ownerId, members, replacementIndex);
  }

  /**
   * "Apply all" after the batch preview: applies replacement `replacementIndex` to `candidateIds` (default:
   * every member of the batch) as accept does, and groups them so undoBatch can take them back in one step.
   * Unchosen members stay pending. Returns the batch id (also on each member's Outcome.batch).
   */
  applyBatch(decisionId: string, candidateIds?: string[], replacementIndex = 0): string {
    const { ownerId, members } = this.resolve(decisionId);
    const chosen = (candidateIds ?? members.map((c) => c.id)).map((id) => {
      const member = members.find((c) => c.id === id);
      if (!member) throw new Error(`${id} is not part of ${decisionId}`);
      return member;
    });
    if (chosen.length === 0) throw new Error(`choose at least one place of ${decisionId} to apply`);
    this.applyMembers(ownerId, chosen, replacementIndex);
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

  /**
   * The one place accept and applyBatch apply edits, so both keep the card guard and the same-text check.
   * `decisionId` is the decision that owns the members (resolve), never one member's own id.
   */
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
    // Doubled words share one fix, keeping the first copy, whatever the word ("had had", "the the"); the
    // simple-fixes card lists each place with its own one fix.
    const allDoubled = members.every((c) => doubledWord(c) !== null);
    if (texts.size > 1 && !allDoubled && decisionId !== SIMPLE_FIXES_ID) {
      throw new Error(
        `${decisionId}: members have different replacements at index ${replacementIndex} (${[...texts].join(' / ')}); accept them one by one`,
      );
    }
    for (const c of members) {
      if (this.ledger.inTrackedChange.has(c.id)) {
        this.ledger.record(c.id, 'pending', false, TRACKED_CHANGE_REASON);
        continue;
      }
      // Never over an edit the user applied, one made a moment ago in this batch included: withdrawCovered takes it out.
      if (c.source !== 'llm' && this.ledger.userEditOver(c)) continue;
      this.ledger.apply(c, c.replacements[replacementIndex], false);
    }
    this.withdrawOutdated();
  }

  /**
   * After the text changed: a rule fix inside an edit the user applied leaves the review (and one no longer covered
   * comes back), and so does a pending AI rewrite of a sentence that now reads differently.
   */
  private withdrawOutdated(): void {
    this.ledger.withdrawCovered();
    this.rewrites.withdrawStale();
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
    // As the user wrote it, not as its first place happens to be (a sentence start's capital): F20 item 9b.
    await this.addWord(dictionaryForm(members.map((c) => c.original)));
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
    const spellings = new Map<string, string[]>(); // lowercased → every spelling on the card, in order
    for (const id of card.candidateIds) {
      const original = this.cands.get(id)!.original;
      spellings.set(original.toLowerCase(), [...(spellings.get(original.toLowerCase()) ?? []), original]);
    }
    for (const [lower, written] of spellings) {
      if (typos.has(lower)) this.typoWords.add(lower);
      else await this.addWord(dictionaryForm(written));
    }
  }

  /**
   * Adds `word` to the linter and rejects every Spelling/Typo flag the entry accepts (dictionaryAccepts) that is
   * pending, or withdrawn under an edit the user applied (else undoing that edit would bring it back as a card: final
   * F14 review M-10). A fix of the word the user applied is taken back, as its Undo would: the next check no longer
   * flags the word, so it would drop the fix without a word (M-12, F20 item 9a). Only that fix: one an AI rewrite was
   * made over is no longer applied (superseded) and stays as it is, with the rewrite.
   */
  private async addWord(word: string): Promise<void> {
    await this.linter.addWords([word]);
    this.added.push(word);
    const reason = `"${word}" added to dictionary`;
    for (const c of this.cands.values()) {
      if (!WORD_REWRITE_KINDS.has(c.kind) || !dictionaryAccepts(word, c.original)) continue;
      const status = this.ledger.status.get(c.id);
      if (status === 'applied' && !this.ledger.autoApplied.has(c.id)) this.undo(c.id);
      else if (status !== 'pending' && !this.ledger.isCovered(c.id)) continue;
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
    // Either way the text, or a rewrite back in review, may no longer match what a pending fix was made for.
    this.withdrawOutdated();
  }

  /**
   * After a re-check: takes back a change this check made without a click and offers it as a card, because the
   * user undid it before, on this paragraph or on a copy of it that can't be told apart (final F15 review M-13).
   * Anything but an auto-fix still applied is left as it is.
   */
  holdBackUndone(candidateId: string): void {
    if (this.ledger.status.get(candidateId) !== 'applied' || !this.ledger.autoApplied.has(candidateId)) return;
    this.holdBack(candidateId, UNDONE_BEFORE_REASON);
    this.withdrawOutdated();
  }

  /** Adds candidates as pending (never auto-applied). Ids already present are ignored. */
  addCandidates(cs: Candidate[]): void {
    for (const c of cs) {
      if (this.cands.has(c.id)) continue;
      this.cands.set(c.id, c);
      this.tiers.set(c.id, this.sessionTier(c));
      this.ledger.status.set(c.id, 'pending');
      const adapterLocked = this.paras.get(c.paraId)?.locked;
      if (adapterLocked?.some((s) => overlaps(c.span, s))) {
        this.ledger.inTrackedChange.add(c.id);
        this.ledger.reasons.set(c.id, TRACKED_CHANGE_REASON);
        if (this.tiers.get(c.id) !== 'hidden') this.tiers.set(c.id, 'review');
      }
    }
    this.ledger.withdrawCovered(); // one added inside an edit the user applied is never offered
  }

  /**
   * tierOf, with its 'safe' split in two (owner decision, Task F4): only a zero-click change (isZeroClickChange:
   * an invisible character, or spaces between words) stays 'safe' and is applied without a click; any other safe
   * fix is 'batch', for the simple-fixes card. No setting changes this split.
   */
  private sessionTier(c: Candidate): Tier {
    const tier = tierOf(c, this.ctx);
    if (tier !== 'safe') return tier;
    const p = this.paras.get(c.paraId)!;
    if (isZeroClickChange(c, p, this.ctx.locked.get(c.paraId), this.alignedParas.has(c.paraId))) return 'safe';
    // Safe only because the user added its kind in Settings: on the card, but never ticked (owner, 2026-10-25).
    if (this.ctx.userTierOverrides && tierOf(c, { ...this.ctx, userTierOverrides: undefined }) !== 'safe') this.optedIn.add(c.id);
    return 'batch';
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
    this.withdrawOutdated();
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

  /**
   * The backstop after autoApply (Task F4), independent of the tiers: in each paragraph, a change made without a
   * click that alters a token (keepsTokens) is taken back and offered for review instead.
   */
  private holdBackChangedTokens(): void {
    for (const [paraId, p] of this.paras) {
      const auto = [...this.ledger.autoApplied].map((id) => this.cands.get(id)!).filter((c) => c.paraId === paraId);
      if (auto.length === 0) continue;
      const edits = auto.map((c) => ({ paraId, span: c.span, replacement: this.ledger.replacement.get(c.id)! }));
      for (const i of editsChangingTokens(p.text, edits, this.hygieneRemovable(paraId))) this.holdBack(auto[i].id, HELD_BACK_REASON);
    }
  }

  /** A change made without a click goes back to pending, offered for review. */
  private holdBack(candidateId: string, reason: string): void {
    this.ledger.autoApplied.delete(candidateId);
    this.ledger.record(candidateId, 'pending', false, reason);
    this.tiers.set(candidateId, 'review');
  }

  /** Offsets in the paragraph of the invisible characters hygiene flagged with a deletion: all the backstop lets go. */
  private hygieneRemovable(paraId: number): Set<number> {
    const flagged = [...this.cands.values()].filter((c) => c.paraId === paraId && c.source === 'hygiene' && c.replacements[0] === '');
    return new Set(flagged.map((c) => c.span.start));
  }

  private members(decisionId: string): Candidate[] {
    return this.resolve(decisionId).members;
  }

  /**
   * A decision id → its members; a pending candidate's id → that candidate alone, with the decision that
   * holds it as `ownerId`, so accepting one member of a card still meets the card's guard (review #4, C2).
   */
  private resolve(id: string): { ownerId: string; members: Candidate[] } {
    const { top, more } = this.decisions();
    const all = [...top, ...more];
    const d = all.find((x) => x.id === id);
    if (d) return { ownerId: d.id, members: d.candidateIds.map((m) => this.cands.get(m)!) };
    const c = this.cands.get(id);
    if (c && this.ledger.status.get(c.id) === 'pending') {
      return { ownerId: all.find((x) => x.candidateIds.includes(id))?.id ?? id, members: [c] };
    }
    throw new Error(`unknown or already decided: ${id}`);
  }
}
