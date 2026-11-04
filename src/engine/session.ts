import { overlapsLocked } from './factLock';
import { SIMPLE_FIXES_ID, type Decision } from './decisions';
import { findAlignedParagraphs, isZeroClickChange } from './zeroClick';
import { editsChangingTokens } from './tokenGuard';
import { checkTermMinRepeats, DEFAULT_TERM_MIN_REPEATS } from './terms';
import { tierOf, type TierContext } from './tiers';
import { EditLedger } from './editLedger';
import { prepareCheck } from './sessionSetup';
import { hasLatinLetter, uncheckedPassages, type UncheckedPassage } from './uncheckedScripts';
import { DEFAULT_DEPTH, type ReviewDepth } from './depth';
import { countWords } from './words';
import { DEFAULT_MODULES, type ModuleSwitches } from './modules';
import { doubledWord, WORD_REWRITE_KINDS } from './wordFlags';
import { dictionaryAccepts, dictionaryForm, storedForm } from './dictionaryWords';
import { sentenceWithEdits } from './sentences';
import type { GuardVerdict } from './llm/guard';
import { HelperRewrites } from './sessionRewrites';
import { CARD_ACCEPT_METHODS, countRankedDecisions, decisionMembers, isOnWordCard, rankDecisions, resolveDecision } from './sessionDecisions';
import type { SessionState } from './sessionState';
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
import type { EngineCapabilities, LanguageEngine } from './languageEngine';
import type { Candidate, Paragraph, Span, Tier, Variant } from './types';

// Public paths stay `engine/session`; the types live in sessionTypes.ts.
export { TRACKED_CHANGE_REASON, type CheckOptions, type Edit, type LogEntry, type Outcome, type SessionDeps, type Status };

export { REWRITE_OUT_OF_DATE } from './sessionRewrites';

/** Why a change made without a click was taken back by the token check (holdBackChangedTokens). */
const HELD_BACK_REASON = 'held back: it would change a word';
const RESTORED_INVISIBLE_REASON = 'it would delete an invisible character you restored';

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
  /** Text inside checked paragraphs that was not really checked (#29), and whether any Latin text was checked. */
  private passages: readonly UncheckedPassage[] = [];
  private latinText = false;

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
      applyOne: (id) => this.applyMembers(id, [this.s.cands.get(id)!], 0),
      newBatch: () => `batch-${++this.s.batchCount}`,
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
    session.proofreader = setup.proofreader;
    const engineOf = (p: Paragraph) => paragraphEngines.get(p.id)!.capabilities;
    // "Not checked" (#2a) is what no engine proofreads; English's #29 passages below skip every non-English paragraph.
    // The two sets differ once another engine proofreads a script.
    session.otherScript = paras.filter((p) => !engineOf(p).proofreads).map((p) => p.id);
    // The foreign sentences were found in setup; passages only report them (checking is unchanged).
    const setAside = new Set(paras.filter((p) => engineOf(p).id !== 'en').map((p) => p.id));
    session.passages = uncheckedPassages(paras, setAside, ctx.foreignSentences ?? new Map());
    session.latinText = paras.some((p) => !setAside.has(p.id) && hasLatinLetter(p.text));
    session.addCandidates(found);
    session.autoApply();
    session.holdBackChangedTokens();
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
   * False when no checked paragraph has a Latin letter (emoji, digits, other scripts only): nothing was checked.
   * Also false when every paragraph was set aside, so callers check otherScriptParagraphs() first to word that case.
   */
  hasEnglishText(): boolean {
    return this.latinText;
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
    const batchId = `batch-${++this.s.batchCount}`;
    for (const c of chosen) if (this.s.ledger.status.get(c.id) === 'applied') this.s.batchOf.set(c.id, batchId);
    return batchId;
  }

  /** Undoes every edit of an applyBatch that is still applied (applied → rejected, as undo does). */
  undoBatch(batchId: string): void {
    const ids = [...this.s.batchOf].filter(([, b]) => b === batchId).map(([id]) => id);
    if (ids.length === 0) throw new Error(`unknown batch ${batchId}`);
    for (const id of ids) {
      this.s.batchOf.delete(id);
      if (this.s.ledger.status.get(id) === 'applied') this.undo(id);
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
      if (this.s.ledger.inTrackedChange.has(c.id)) {
        this.s.ledger.record(c.id, 'pending', false, TRACKED_CHANGE_REASON);
        continue;
      }
      // Never over an edit the user applied, one made a moment ago in this batch included: withdrawCovered takes it out.
      if (c.source !== 'llm' && this.s.ledger.userEditOver(c)) continue;
      if (this.coversRestoredInvisible(c)) {
        this.markUnplaceable(c.id, RESTORED_INVISIBLE_REASON);
        continue;
      }
      this.s.ledger.apply(c, c.replacements[replacementIndex], false);
    }
    this.withdrawOutdated();
  }

  /**
   * After the text changed: a rule fix inside an edit the user applied leaves the review (and one no longer covered
   * comes back), and so does a pending AI rewrite of a sentence that now reads differently.
   */
  private withdrawOutdated(): void {
    this.s.ledger.withdrawCovered();
    this.s.rewrites.withdrawStale();
  }

  /**
   * A fix's replacement was made on text without invisible characters, so over one the user kept (undid or
   * declined its removal) it would delete that character again (#9). Known only after setup, so checked on accept.
   */
  private coversRestoredInvisible(c: Candidate): boolean {
    if (c.kind === 'Invisible') return false;
    return [...this.s.userRejected].some((id) => {
      const o = this.s.cands.get(id);
      return o?.kind === 'Invisible' && o.paraId === c.paraId && c.span.start <= o.span.start && o.span.end <= c.span.end;
    });
  }

  reject(decisionId: string): void {
    for (const c of this.members(decisionId)) {
      this.s.userRejected.add(c.id);
      this.s.ledger.record(c.id, 'rejected', false);
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
      const original = this.s.cands.get(id)!.original;
      spellings.set(original.toLowerCase(), [...(spellings.get(original.toLowerCase()) ?? []), original]);
    }
    for (const [lower, written] of spellings) {
      if (typos.has(lower)) this.s.typoWords.add(lower);
      else await this.addWord(dictionaryForm(written));
    }
  }

  /**
   * Adds `word` to the linter and rejects every Spelling/Typo flag the entry accepts (dictionaryAccepts) that is
   * pending, or withdrawn under an edit the user applied (else undoing that edit would bring it back as a card: final
   * F14 review M-10). A fix of the word the user applied is taken back, as its Undo would: the next check no longer
   * flags the word, so it would drop the fix without a word (M-12, F20 item 9a). So is a fix the user accepted and an
   * AI rewrite was then made over, with the same log entry (#11); the rewrite stays, since it holds the text it replaced.
   */
  private async addWord(written: string): Promise<void> {
    const word = storedForm(written); // "Cutover" is stored as "cutover" (Task F29)
    for (const engine of this.s.engines) await engine.addWords([word]);
    this.s.added.push(word);
    const reason = `"${word}" added to dictionary`;
    for (const c of this.s.cands.values()) {
      if (!WORD_REWRITE_KINDS.has(c.kind) || !dictionaryAccepts(word, c.original)) continue;
      const status = this.s.ledger.status.get(c.id);
      if (status === 'applied' && !this.s.ledger.autoApplied.has(c.id)) this.undo(c.id);
      else if (status !== 'pending' && !this.s.ledger.isCovered(c.id) && this.s.ledger.appliedOver(c.id) === undefined) continue;
      this.s.userRejected.add(c.id);
      this.s.ledger.record(c.id, 'rejected', false, reason);
    }
  }

  /** A word typed into the Dictionary panel (F22 item 1): added as addToDictionary adds a flagged word. */
  async addTypedWord(word: string): Promise<void> {
    await this.addWord(word);
  }

  /** Words added with addToDictionary, addTypedWord or by accepting a card, in order. */
  addedWords(): string[] {
    return [...this.s.added];
  }

  /** applied → rejected; rejected (by the user) → pending. */
  undo(candidateId: string): void {
    const s = this.s.ledger.status.get(candidateId);
    if (s === 'applied') {
      this.s.batchOf.delete(candidateId);
      this.s.ledger.autoApplied.delete(candidateId);
      this.s.userRejected.add(candidateId);
      this.s.ledger.record(candidateId, 'rejected', false, 'undone');
      this.s.ledger.restoreSuperseded(candidateId);
    } else if (s === 'rejected' && this.s.userRejected.has(candidateId)) {
      this.s.userRejected.delete(candidateId);
      this.s.ledger.record(candidateId, 'pending', false);
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
    if (this.s.ledger.status.get(candidateId) !== 'applied' || !this.s.ledger.autoApplied.has(candidateId)) return;
    this.holdBack(candidateId, UNDONE_BEFORE_REASON);
    this.withdrawOutdated();
  }

  /** Adds candidates as pending (never auto-applied). Ids already present are ignored. */
  addCandidates(cs: Candidate[]): void {
    for (const c of cs) {
      if (this.s.cands.has(c.id)) continue;
      this.s.cands.set(c.id, c);
      this.s.tiers.set(c.id, this.sessionTier(c));
      this.s.ledger.status.set(c.id, 'pending');
      const adapterLocked = this.s.paras.get(c.paraId)?.locked;
      if (adapterLocked?.some((s) => overlaps(c.span, s))) {
        this.s.ledger.inTrackedChange.add(c.id);
        this.s.ledger.reasons.set(c.id, TRACKED_CHANGE_REASON);
        if (this.s.tiers.get(c.id) !== 'hidden') this.s.tiers.set(c.id, 'review');
      }
    }
    this.s.ledger.withdrawCovered(); // one added inside an edit the user applied is never offered
  }

  /**
   * tierOf, with its 'safe' split in two (owner decision, Task F4): only a zero-click change (isZeroClickChange:
   * an invisible character, or spaces between words) stays 'safe' and is applied without a click; any other safe
   * fix is 'batch', for the simple-fixes card. No setting changes this split.
   */
  private sessionTier(c: Candidate): Tier {
    const tier = tierOf(c, this.s.ctx);
    if (tier !== 'safe') return tier;
    const p = this.s.paras.get(c.paraId)!;
    // Maybe-command text is never changed without a click either (Task F21c, review M-24).
    const untouched = [...(this.s.ctx.locked.get(c.paraId) ?? []), ...(this.s.ctx.maybeCommandSpans?.get(c.paraId) ?? [])];
    if (isZeroClickChange(c, p, untouched, this.s.alignedParas.has(c.paraId))) return 'safe';
    // Safe only because the user added its kind in Settings: on the card, but never ticked (owner, 2026-10-25).
    if (this.s.ctx.userTierOverrides && tierOf(c, { ...this.s.ctx, userTierOverrides: undefined }) !== 'safe') this.s.optedIn.add(c.id);
    return 'batch';
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
    if (!this.s.cands.has(candidateId)) throw new Error(`unknown candidate ${candidateId}`);
    this.s.unplaceable.set(candidateId, reason);
    this.s.ledger.record(candidateId, 'rejected', this.s.ledger.autoApplied.has(candidateId), `unplaceable: ${reason}`);
    this.s.ledger.restoreSuperseded(candidateId);
    this.withdrawOutdated();
  }

  // ---- internals -----------------------------------------------------------

  private autoApply(): void {
    const safe = [...this.s.cands.values()].filter((c) => this.s.tiers.get(c.id) === 'safe').sort(byPosition);
    for (const c of safe) {
      if (this.s.ledger.clashing(c).length) {
        this.s.tiers.set(c.id, 'review');
        continue;
      }
      this.s.ledger.apply(c, c.replacements[0], true);
    }
  }

  /**
   * The backstop after autoApply (Task F4), independent of the tiers: in each paragraph, a change made without a
   * click that alters a token (keepsTokens) is taken back and offered for review instead.
   */
  private holdBackChangedTokens(): void {
    for (const [paraId, p] of this.s.paras) {
      const auto = [...this.s.ledger.autoApplied].map((id) => this.s.cands.get(id)!).filter((c) => c.paraId === paraId);
      if (auto.length === 0) continue;
      const edits = auto.map((c) => ({ paraId, span: c.span, replacement: this.s.ledger.replacement.get(c.id)! }));
      for (const i of editsChangingTokens(p.text, edits, this.hygieneRemovable(paraId))) this.holdBack(auto[i].id, HELD_BACK_REASON);
    }
  }

  /** A change made without a click goes back to pending, offered for review. */
  private holdBack(candidateId: string, reason: string): void {
    this.s.ledger.autoApplied.delete(candidateId);
    this.s.ledger.record(candidateId, 'pending', false, reason);
    this.s.tiers.set(candidateId, 'review');
  }

  /** Offsets in the paragraph of the invisible characters hygiene flagged with a deletion: all the backstop lets go. */
  private hygieneRemovable(paraId: number): Set<number> {
    const flagged = [...this.s.cands.values()].filter((c) => c.paraId === paraId && c.source === 'hygiene' && c.replacements[0] === '');
    return new Set(flagged.map((c) => c.span.start));
  }

  private members(decisionId: string): Candidate[] {
    return decisionMembers(this.s, decisionId);
  }

  /**
   * A decision id → its members; a pending candidate's id → that candidate alone, with the decision that
   * holds it as `ownerId`, so accepting one member of a card still meets the card's guard (review #4, C2).
   */
  private resolve(id: string): { ownerId: string; members: Candidate[] } {
    return resolveDecision(this.s, id);
  }
}
