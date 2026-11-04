import { overlapsLocked } from './factLock';
import type { Decision } from './decisions';
import { findAlignedParagraphs } from './zeroClick';
import { checkTermMinRepeats, DEFAULT_TERM_MIN_REPEATS } from './terms';
import type { TierContext } from './tiers';
import { EditLedger } from './editLedger';
import { prepareCheck } from './sessionSetup';
import { hasLetterOf, mostlyNotChecked, uncheckedPassages, type UncheckedPassage } from './uncheckedScripts';
import { DEFAULT_DEPTH, type ReviewDepth } from './depth';
import { countWords } from './words';
import { DEFAULT_MODULES, type ModuleSwitches } from './modules';
import { sentenceWithEdits } from './sentences';
import type { GuardVerdict } from './llm/guard';
import { HelperRewrites } from './sessionRewrites';
import { countRankedDecisions, isOnWordCard, rankDecisions, resolveDecision } from './sessionDecisions';
import { applyBatch, applyMembers, holdBackUndone, markUnplaceable, newBatchId, rejectDecision, undo, undoBatch } from './sessionEdits';
import { acceptWordCard, addFlaggedWord, addWord } from './sessionDictionary';
import { addCandidates, autoApply, holdBackChangedTokens } from './sessionIntake';
import type { SessionState } from './sessionState';
import {
  byPosition,
  TRACKED_CHANGE_REASON,
  type CheckOptions,
  type Edit,
  type LogEntry,
  type Outcome,
  type SessionDeps,
  type Status,
} from './sessionTypes';
import type { EngineCapabilities, LanguageEngine } from './languageEngine';
import type { Candidate, Paragraph, Span, Tier, Variant } from './types';

// Public paths stay `engine/session`; the types live in sessionTypes.ts.
export { TRACKED_CHANGE_REASON, type CheckOptions, type Edit, type LogEntry, type Outcome, type SessionDeps, type Status };

export { REWRITE_OUT_OF_DATE } from './sessionRewrites';

export class CheckSession {
  private readonly s: SessionState;
  private readonly paraNumber = new Map<number, number>();
  /** Paragraphs the linter threw on, so their rules weren't checked (Task F21d, review I-4). */
  private unchecked: readonly number[] = [];
  /** Paragraphs mostly in another script, set aside whole (#2a): those whose engine does not proofread. */
  private otherScript: readonly number[] = [];
  /** The engine that checked each paragraph, by paragraph id (#2b). */
  private paragraphEngines = new Map<number, LanguageEngine>();
  /** The document's one proofreading engine (owner, 2026-11-02: never several at once). */
  private proofreader: LanguageEngine | null = null;
  /** Text inside checked paragraphs that was not really checked (#29), and whether any text of the proofread script was checked. */
  private passages: readonly UncheckedPassage[] = [];
  private checkedText = false;
  private mostlyUnchecked = false;

  private constructor(
    paras: Paragraph[],
    readonly variant: Variant,
    readonly mixedVariant: boolean,
    /** True when the text's spelling did not choose the variant: it is the fallback ("default", not "detected"). */
    readonly variantFromFallback: boolean,
    ctx: TierContext,
    now: () => Date,
    reviewDepth: ReviewDepth,
    termMinRepeats: number,
  ) {
    const cands = new Map<string, Candidate>();
    const state: Omit<SessionState, 'rewrites'> = {
      paras: new Map<number, Paragraph>(),
      cands,
      tiers: new Map<string, Tier>(),
      ledger: new EditLedger(cands, now),
      ctx,
      userRejected: new Set<string>(),
      unplaceable: new Map<string, string>(),
      typoWords: new Set<string>(),
      optedIn: new Set<string>(),
      alignedParas: findAlignedParagraphs(paras),
      batchOf: new Map<string, string>(),
      added: [],
      words: paras.reduce((n, p) => n + countWords(p.text), 0),
      termMinRepeats,
      batchCount: 0,
      reviewDepth,
      engines: [],
    };
    paras.forEach((p, i) => {
      state.paras.set(p.id, p);
      this.paraNumber.set(p.id, i + 1);
    });
    const rewrites = new HelperRewrites({
      paragraph: (paraId) => this.s.paras.get(paraId),
      sentenceNow: (paraId, span) => sentenceWithEdits(this.s.paras.get(paraId)!.text, span, this.acceptedEdits().filter((e) => e.paraId === paraId)),
      candidate: (id) => this.s.cands.get(id),
      status: (id) => this.s.ledger.status.get(id),
      rejectedByUser: (id) => this.s.userRejected.has(id),
      addCandidate: (c) => this.addCandidates([c]),
      replaceWithdrawn: (c) => {
        this.s.cands.set(c.id, c);
        // The id's earlier life may have been applied: its old text must not show in the outcome or the log.
        this.s.ledger.replacement.delete(c.id);
        this.s.ledger.record(c.id, 'pending', false);
      },
      withdraw: (id, reason) => this.s.ledger.record(id, 'superseded', false, reason),
      applyOne: (id) => applyMembers(this.s, id, [this.s.cands.get(id)!], 0),
      newBatch: () => newBatchId(this.s),
      joinBatch: (id, batchId) => this.s.batchOf.set(id, batchId),
      accept: (id) => this.accept(id),
      reject: (id) => this.reject(id),
    });
    this.s = { ...state, rewrites };
  }

  static async start(paras: Paragraph[], opts: CheckOptions, deps: SessionDeps = {}): Promise<CheckSession> {
    const termMinRepeats = opts.termMinRepeats ?? DEFAULT_TERM_MIN_REPEATS;
    checkTermMinRepeats(termMinRepeats);
    const setup = await prepareCheck(paras, opts, deps);
    const { paragraphEngines, variant, mixedVariant, variantFromFallback, ctx, found } = setup;
    const now = deps.now ?? (() => new Date());
    const depth = opts.depth ?? DEFAULT_DEPTH;
    const session = new CheckSession(paras, variant, mixedVariant, variantFromFallback, ctx, now, depth, termMinRepeats);
    session.unchecked = setup.uncheckedParagraphs;
    session.paragraphEngines = paragraphEngines;
    session.s.engines = setup.engines;
    const { proofreader, proofreaderScript } = setup;
    session.proofreader = proofreader;
    const engineOf = (p: Paragraph) => paragraphEngines.get(p.id)!.capabilities;
    // "Not checked" (#2a) is what no engine proofreads; English's #29 passages below skip every non-English paragraph.
    // The two sets differ once another engine proofreads a script.
    session.otherScript = paras.filter((p) => !engineOf(p).proofreads).map((p) => p.id);
    // Passages and checked text follow the proofreader's script. Its set-aside paragraphs are those another engine
    // checks (the not-checked one, or English in a document another engine proofreads).
    const setAside = new Set(paras.filter((p) => engineOf(p).id !== proofreader.capabilities.id).map((p) => p.id));
    // Foreign sentences were found in setup, by English only: for any other script there are none to report.
    const foreign = proofreader.capabilities.id === 'en' ? (ctx.foreignSentences ?? new Map()) : new Map();
    session.passages = uncheckedPassages(paras, setAside, foreign, proofreaderScript);
    session.checkedText = paras.some((p) => !setAside.has(p.id) && hasLetterOf(p.text, proofreaderScript));
    session.mostlyUnchecked = mostlyNotChecked(paras, setAside);
    addCandidates(session.s, found);
    autoApply(session.s);
    holdBackChangedTokens(session.s);
    return session;
  }

  // ---- queries -------------------------------------------------------------

  candidates(): Candidate[] {
    return [...this.s.cands.values()];
  }

  /** The paragraphs as given to start(), in document order. */
  paragraphs(): Paragraph[] {
    return [...this.s.paras.values()].map((p) => ({ ...p }));
  }

  /** The ids of the paragraphs the rules couldn't check (the linter threw on them), in document order. */
  uncheckedParagraphs(): number[] {
    return [...this.unchecked];
  }

  /**
   * The ids of the paragraphs set aside, in document order: no engine proofreads them (another script, or English in
   * a document another engine proofreads).
   */
  otherScriptParagraphs(): readonly number[] {
    return this.otherScript;
  }

  /** What the engine that checked this paragraph can do (#2b); undefined for an id not in the document. */
  engineOf(paraId: number): EngineCapabilities | undefined {
    return this.paragraphEngines.get(paraId)?.capabilities;
  }

  /**
   * What the document's proofreading engine can do (#2b), as a list of that one engine: one per document, so the
   * list never holds more. The UI words its labels from it.
   */
  proofreadingEngines(): EngineCapabilities[] {
    return this.proofreader ? [this.proofreader.capabilities] : [];
  }

  /** Words in another script and sentences in another language inside checked paragraphs: reported, not checked (#29). */
  uncheckedPassages(): UncheckedPassage[] {
    return [...this.passages];
  }

  /**
   * False when the checked paragraphs hold no letter of the proofread script: nothing was checked.
   * Also false when every paragraph was set aside, so callers check otherScriptParagraphs() first to word that case.
   */
  hasCheckedText(): boolean {
    return this.checkedText;
  }

  /** True when the set-aside paragraphs hold more letters than the checked ones: most of the document was not read. */
  mostlyNotChecked(): boolean {
    return this.mostlyUnchecked;
  }

  /** True once addRewrite recorded this sentence, whatever the helper answered. */
  sentToHelper(paraId: number, span: Span): boolean {
    return this.s.rewrites.sentToHelper(paraId, span);
  }

  tier(id: string): Tier {
    const t = this.s.tiers.get(id);
    if (!t) throw new Error(`unknown candidate ${id}`);
    return t;
  }

  decisions(): { top: Decision[]; more: Decision[] } {
    return rankDecisions(this.s);
  }

  get depth(): ReviewDepth {
    return this.s.reviewDepth;
  }

  /** The optional modules this check ran with. */
  get modules(): ModuleSwitches {
    return { ...(this.s.ctx.modules ?? DEFAULT_MODULES) };
  }

  /** Changes how many decisions show up front. Statuses and tiers are untouched. */
  setDepth(depth: ReviewDepth): void {
    this.s.reviewDepth = depth;
  }

  /** True when the candidate overlaps a fact-locked span or an adapter-locked (tracked change) span. */
  touchesLocked(candidateId: string): boolean {
    const c = this.s.cands.get(candidateId);
    if (!c) throw new Error(`unknown candidate ${candidateId}`);
    return this.s.ledger.inTrackedChange.has(c.id) || overlapsLocked(c, this.s.ctx.locked.get(c.paraId));
  }

  /** True when the candidate is pending on the names, terms or Indian-language card: answered with that card's method, never accept. */
  onWordCard(candidateId: string): boolean {
    return isOnWordCard(this.s, candidateId);
  }

  /** For an edit the user applied and a later edit (an AI rewrite) superseded: that edit's id, while it stays applied. */
  appliedOver(candidateId: string): string | undefined {
    return this.s.ledger.appliedOver(candidateId);
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
    return countRankedDecisions(this.s);
  }

  log(): LogEntry[] {
    return this.s.ledger.log();
  }

  acceptedEdits(): Edit[] {
    const out: Edit[] = [];
    for (const c of this.s.cands.values()) {
      if (this.s.ledger.status.get(c.id) !== 'applied') continue;
      out.push({ paraId: c.paraId, span: { ...c.span }, replacement: this.s.ledger.replacement.get(c.id)! });
    }
    return out.sort(byPosition);
  }

  outputText(paraId: number): string {
    const p = this.s.paras.get(paraId);
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
    return [...this.s.cands.values()].sort(byPosition).map((c) => ({
      candidate: c,
      paragraphNumber: this.paraNumber.get(c.paraId) ?? c.paraId + 1,
      status: this.s.ledger.status.get(c.id)!,
      auto: this.s.ledger.autoApplied.has(c.id),
      replacement: this.s.ledger.replacement.get(c.id) ?? c.replacements[0],
      reason: this.s.ledger.reasons.get(c.id),
      unplaceable: this.s.unplaceable.get(c.id),
      batch: this.s.ledger.status.get(c.id) === 'applied' ? this.s.batchOf.get(c.id) : undefined,
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
    applyMembers(this.s, ownerId, members, replacementIndex);
  }

  /**
   * "Apply all" after the batch preview: applies replacement `replacementIndex` to `candidateIds` (default:
   * every member of the batch) as accept does, and groups them so undoBatch can take them back in one step.
   * Unchosen members stay pending. Returns the batch id (also on each member's Outcome.batch).
   */
  applyBatch(decisionId: string, candidateIds?: string[], replacementIndex = 0): string {
    return applyBatch(this.s, decisionId, candidateIds, replacementIndex);
  }

  /** Undoes every edit of an applyBatch that is still applied (applied → rejected, as undo does). */
  undoBatch(batchId: string): void {
    undoBatch(this.s, batchId);
  }

  reject(decisionId: string): void {
    rejectDecision(this.s, decisionId);
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
    await addFlaggedWord(this.s, decisionId);
  }

  /**
   * Accepts the names card (spec §5): every distinct name on it goes into the dictionary (as
   * addToDictionary does), except the words in `keepAsTypos` (any case), which leave the card and
   * become their own per-word decisions so the user can fix them.
   */
  async acceptNames(keepAsTypos: string[]): Promise<void> {
    await acceptWordCard(this.s, 'names', keepAsTypos);
  }

  /** Accepts the terms card (spec §5) the same way as acceptNames: terms join the dictionary, `keepAsTypos` split out. */
  async acceptTerms(keepAsTypos: string[]): Promise<void> {
    await acceptWordCard(this.s, 'terms', keepAsTypos);
  }

  /**
   * Accepts the words-in-Indian-languages card (spec §5) the same way as acceptNames: the Indian-language words
   * join the dictionary, `keepAsTypos` split out. So do the card's likely typos ("jion", near "join"), unless
   * they are in `tickedLikelyTypos` (the user ticked them explicitly): "Add all" never adds one.
   */
  async acceptOtherLanguage(keepAsTypos: string[], tickedLikelyTypos: string[] = []): Promise<void> {
    const ticked = new Set(tickedLikelyTypos.map((w) => w.toLowerCase()));
    await acceptWordCard(this.s, 'otherLanguage', keepAsTypos, (card) =>
      (card.likelyTypos ?? []).map(([word]) => word).filter((word) => !ticked.has(word)),
    );
  }

  /** A word typed into the Dictionary panel (F22 item 1): added as addToDictionary adds a flagged word. */
  async addTypedWord(word: string): Promise<void> {
    await addWord(this.s, word);
  }

  /** Words added with addToDictionary, addTypedWord or by accepting a card, in order. */
  addedWords(): string[] {
    return [...this.s.added];
  }

  /** applied → rejected; rejected (by the user) → pending. */
  undo(candidateId: string): void {
    undo(this.s, candidateId);
  }

  /**
   * After a re-check: takes back a change this check made without a click and offers it as a card, because the
   * user undid it before, on this paragraph or on a copy of it that can't be told apart (final F15 review M-13).
   * Anything but an auto-fix still applied is left as it is.
   */
  holdBackUndone(candidateId: string): void {
    holdBackUndone(this.s, candidateId);
  }

  /** Adds candidates as pending (never auto-applied). Ids already present are ignored. */
  addCandidates(cs: Candidate[]): void {
    addCandidates(this.s, cs);
  }

  /** The helper's answer for a sentence, through the meaning-drift guard; 'stale' when the sentence changed (see HelperRewrites.add). */
  addRewrite(paraId: number, span: Span, rewrite: string | null, sentText?: string): GuardVerdict | 'stale' | null {
    return this.s.rewrites.add(paraId, span, rewrite, sentText);
  }

  /** "Accept all helper suggestions", one undo step (see HelperRewrites.applyAll). Returns the batch id. */
  applyRewrites(candidateIds: string[]): string {
    return this.s.rewrites.applyAll(candidateIds);
  }

  /** After a re-check: the AI answers on unchanged paragraphs come back (see HelperRewrites.carryFrom). Old id → new id. */
  carryRewritesFrom(before: CheckSession, unchanged: Map<number, number>): Map<string, string> {
    return this.s.rewrites.carryFrom(before.s.rewrites, unchanged);
  }

  /** Applied AI rewrites the re-check could not carry (old ids), so the caller can say so (#39). */
  droppedAppliedRewrites(): readonly string[] {
    return this.s.rewrites.droppedAppliedRewrites();
  }

  /** The adapter could not write this edit into the document: it leaves the output. */
  markUnplaceable(candidateId: string, reason: string): void {
    markUnplaceable(this.s, candidateId, reason);
  }

  // ---- internals -----------------------------------------------------------

  private resolve(id: string): { ownerId: string; members: Candidate[] } {
    return resolveDecision(this.s, id);
  }
}
