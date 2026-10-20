import { createLinter, type RulesLinter } from './linter';
import { detectVariant } from './variant';
import { findInvisible } from './hygiene';
import { findLockedSpans } from './factLock';
import { PRESETS, type PresetId } from './presets';
import { buildDecisions, overlapsLocked, findContractions, foldsUnderMore, tierOf, type Decision, type TierContext } from './tiers';
import type { Candidate, Paragraph, Span, Tier, Variant } from './types';

export interface CheckOptions {
  preset: PresetId;
  /** When given, variant detection is skipped. */
  variant?: Variant;
  fallbackVariant: Variant;
  language: 'plaintext' | 'markdown';
  dictionary: string[];
  /** Per-kind tier overrides (passed to TierContext.userTierOverrides). */
  tierOverrides?: Partial<Record<string, Tier>>;
}

export interface SessionDeps {
  /** Reused instead of creating a linter (the UI passes one built with the browser binary). */
  linter?: RulesLinter;
  /** Clock for LogEntry.at. */
  now?: () => Date;
}

export interface Edit {
  paraId: number;
  span: Span;
  replacement: string;
}

export type Status = 'pending' | 'applied' | 'rejected' | 'superseded';

export interface LogEntry {
  candidateId: string;
  status: Status;
  auto: boolean;
  at: string;
  reason?: string;
  /** The replacement chosen for this candidate (kept after undo). */
  replacement?: string;
}

/** Final state of one candidate, for reports. */
export interface Outcome {
  candidate: Candidate;
  /** 1-based position of the paragraph in the document. */
  paragraphNumber: number;
  status: Status;
  auto: boolean;
  /** The replacement applied (or proposed, for rejected). */
  replacement?: string;
  reason?: string;
  unplaceable?: string;
}

export const TRACKED_CHANGE_REASON = 'inside an existing tracked change';
const TOP = 10;
/** Kinds whose flags are about one word (unknown to the dictionary). */
const WORD_FLAG_KINDS = new Set(['Spelling', 'Typo']);

/** Overlap of two edits; zero-width spans clash when they sit at the same point or inside the other. */
function overlaps(a: Span, b: Span): boolean {
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  if (a.start === a.end) return b.start < a.start && a.start < b.end;
  if (b.start === b.end) return a.start < b.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

const byPosition = (a: { paraId: number; span: Span }, b: { paraId: number; span: Span }) =>
  a.paraId - b.paraId || a.span.start - b.span.start || a.span.end - b.span.end;

const addedWords = new WeakMap<RulesLinter, Set<string>>();

export class CheckSession {
  private readonly paras = new Map<number, Paragraph>();
  private readonly paraNumber = new Map<number, number>();
  private readonly cands = new Map<string, Candidate>();
  private readonly tiers = new Map<string, Tier>();
  private readonly status = new Map<string, Status>();
  private readonly replacement = new Map<string, string>();
  private readonly autoApplied = new Set<string>();
  private readonly userRejected = new Set<string>();
  private readonly unplaceable = new Map<string, string>();
  private readonly reasons = new Map<string, string>();
  /** Candidates overlapping an adapter-supplied Paragraph.locked span. */
  private readonly inTrackedChange = new Set<string>();
  /** superseded candidate id → id of the edit that superseded it. */
  private readonly supersededBy = new Map<string, string>();
  private readonly entries: LogEntry[] = [];
  private readonly added: string[] = [];

  private constructor(
    paras: Paragraph[],
    readonly variant: Variant,
    readonly mixedVariant: boolean,
    private readonly ctx: TierContext,
    private readonly now: () => Date,
    private readonly linter: RulesLinter,
  ) {
    paras.forEach((p, i) => {
      this.paras.set(p.id, p);
      this.paraNumber.set(p.id, i + 1);
    });
  }

  static async start(paras: Paragraph[], opts: CheckOptions, deps: SessionDeps = {}): Promise<CheckSession> {
    const linter = deps.linter ?? (await createLinter(opts.variant ?? opts.fallbackVariant, opts.dictionary));
    if (deps.linter && opts.dictionary.length) {
      const seen = addedWords.get(linter) ?? new Set<string>();
      addedWords.set(linter, seen);
      const fresh = opts.dictionary.filter((w) => !seen.has(w));
      if (fresh.length) {
        await linter.addWords(fresh);
        fresh.forEach((w) => seen.add(w));
      }
    }

    // With an explicit variant, detection still runs to compute its variantWords (never auto-converted).
    const { variant, mixed, variantWords } = await detectVariant(paras, opts.fallbackVariant, {
      linter,
      variant: opts.variant,
    });
    if (linter.variant !== variant) await linter.setVariant(variant);

    const locked = new Map<number, Span[]>();
    for (const p of paras) locked.set(p.id, [...findLockedSpans(p.text), ...(p.locked ?? [])]);
    const preset = PRESETS[opts.preset];
    const paraText = new Map(paras.map((p) => [p.id, p.text]));
    const ctx: TierContext = { locked, variantWords, preset, userTierOverrides: opts.tierOverrides, paraText, variant };

    const session = new CheckSession(paras, variant, mixed, ctx, deps.now ?? (() => new Date()), linter);

    const found: Candidate[] = await linter.lintParagraphs(paras, opts.language);
    for (const p of paras) {
      found.push(...findInvisible(p));
      if (preset.extraRules.includes('contractions')) found.push(...findContractions(p, locked.get(p.id)));
    }
    found.sort(byPosition);
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
    const tracked: Candidate[] = [];
    const tiers = new Map<string, Tier>();
    for (const c of this.cands.values()) {
      if (this.status.get(c.id) !== 'pending' || this.unplaceable.has(c.id)) continue;
      const t = this.tiers.get(c.id)!;
      if (t === 'hidden') continue;
      (this.inTrackedChange.has(c.id) ? tracked : pending).push(c);
      // A safe candidate is only pending after an undo/restore: offer it for review.
      tiers.set(c.id, t === 'safe' ? 'review' : t);
    }
    // Candidates on fact-locked spans (names, numbers, quotes…) are demoted: ranked last, never dropped.
    const { decisions } = buildDecisions(pending, tiers, (c) =>
      foldsUnderMore(c, this.ctx.locked.get(c.paraId), this.paras.get(c.paraId)?.text),
    );
    // Inside an existing tracked change: can't be applied, so never in `top`.
    const blocked = buildDecisions(tracked, tiers).decisions;
    return { top: decisions.slice(0, TOP), more: [...decisions.slice(TOP), ...blocked] };
  }

  /** True when the candidate overlaps a fact-locked span or an adapter-locked (tracked change) span. */
  touchesLocked(candidateId: string): boolean {
    const c = this.cands.get(candidateId);
    if (!c) throw new Error(`unknown candidate ${candidateId}`);
    return this.inTrackedChange.has(c.id) || overlapsLocked(c, this.ctx.locked.get(c.paraId));
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
    return top.length + more.filter((d) => !d.candidateIds.some((id) => this.inTrackedChange.has(id))).length;
  }

  log(): LogEntry[] {
    return [...this.entries];
  }

  acceptedEdits(): Edit[] {
    const out: Edit[] = [];
    for (const c of this.cands.values()) {
      if (this.status.get(c.id) !== 'applied') continue;
      out.push({ paraId: c.paraId, span: { ...c.span }, replacement: this.replacement.get(c.id)! });
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
      status: this.status.get(c.id)!,
      auto: this.autoApplied.has(c.id),
      replacement: this.replacement.get(c.id) ?? c.replacements[0],
      reason: this.reasons.get(c.id),
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
      if (this.inTrackedChange.has(c.id)) {
        this.record(c.id, 'pending', false, TRACKED_CHANGE_REASON);
        continue;
      }
      this.apply(c, c.replacements[replacementIndex], false);
    }
  }

  reject(decisionId: string): void {
    for (const c of this.members(decisionId)) {
      this.userRejected.add(c.id);
      this.record(c.id, 'rejected', false);
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
    if (!WORD_FLAG_KINDS.has(first.kind) || members.some((c) => c.original.toLowerCase() !== first.original.toLowerCase())) {
      throw new Error(`${decisionId} is not a word flag (Spelling/Typo of one word)`);
    }
    const word = first.original;
    await this.linter.addWords([word]);
    this.added.push(word);
    const reason = `"${word}" added to dictionary`;
    for (const c of this.cands.values()) {
      if (this.status.get(c.id) !== 'pending' || !WORD_FLAG_KINDS.has(c.kind)) continue;
      if (c.original.toLowerCase() !== word.toLowerCase()) continue;
      this.userRejected.add(c.id);
      this.record(c.id, 'rejected', false, reason);
    }
  }

  /** Words added with addToDictionary, in order. */
  addedWords(): string[] {
    return [...this.added];
  }

  /** applied → rejected; rejected (by the user) → pending. */
  undo(candidateId: string): void {
    const s = this.status.get(candidateId);
    if (s === 'applied') {
      this.autoApplied.delete(candidateId);
      this.userRejected.add(candidateId);
      this.record(candidateId, 'rejected', false, 'undone');
      this.restoreSuperseded(candidateId);
    } else if (s === 'rejected' && this.userRejected.has(candidateId)) {
      this.userRejected.delete(candidateId);
      this.record(candidateId, 'pending', false);
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
      this.status.set(c.id, 'pending');
      const adapterLocked = this.paras.get(c.paraId)?.locked;
      if (adapterLocked?.some((s) => overlaps(c.span, s))) {
        this.inTrackedChange.add(c.id);
        this.reasons.set(c.id, TRACKED_CHANGE_REASON);
        if (this.tiers.get(c.id) === 'safe') this.tiers.set(c.id, 'review');
      }
    }
  }

  /** The adapter could not write this edit into the document: it leaves the output. */
  markUnplaceable(candidateId: string, reason: string): void {
    if (!this.cands.has(candidateId)) throw new Error(`unknown candidate ${candidateId}`);
    this.unplaceable.set(candidateId, reason);
    this.record(candidateId, 'rejected', this.autoApplied.has(candidateId), `unplaceable: ${reason}`);
    this.restoreSuperseded(candidateId);
  }

  // ---- internals -----------------------------------------------------------

  private autoApply(): void {
    const safe = [...this.cands.values()].filter((c) => this.tiers.get(c.id) === 'safe').sort(byPosition);
    for (const c of safe) {
      if (this.clashing(c).length) {
        this.tiers.set(c.id, 'review');
        continue;
      }
      this.apply(c, c.replacements[0], true);
    }
  }

  private members(decisionId: string): Candidate[] {
    const { top, more } = this.decisions();
    const d = [...top, ...more].find((x) => x.id === decisionId);
    if (d) return d.candidateIds.map((id) => this.cands.get(id)!);
    const c = this.cands.get(decisionId);
    if (c && this.status.get(c.id) === 'pending') return [c];
    throw new Error(`unknown or already decided: ${decisionId}`);
  }

  private clashing(c: Candidate): Candidate[] {
    const out: Candidate[] = [];
    for (const o of this.cands.values()) {
      if (o.id !== c.id && o.paraId === c.paraId && this.status.get(o.id) === 'applied' && overlaps(o.span, c.span)) {
        out.push(o);
      }
    }
    return out;
  }

  private apply(c: Candidate, replacement: string, auto: boolean): void {
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
  private restoreSuperseded(byId: string): void {
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

  private record(candidateId: string, status: Status, auto: boolean, reason?: string): void {
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
