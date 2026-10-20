import { createLinter, type RulesLinter } from './linter';
import { detectVariant } from './variant';
import { findInvisible } from './hygiene';
import { findLockedSpans } from './factLock';
import { PRESETS, type PresetId } from './presets';
import { buildDecisions, findContractions, tierOf, type Decision, type TierContext } from './tiers';
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
  private readonly entries: LogEntry[] = [];

  private constructor(
    paras: Paragraph[],
    readonly variant: Variant,
    readonly mixedVariant: boolean,
    private readonly ctx: TierContext,
    private readonly now: () => Date,
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

    let variant: Variant;
    let mixed = false;
    let variantWords = new Set<string>();
    if (opts.variant) {
      variant = opts.variant;
    } else {
      const r = await detectVariant(paras, opts.fallbackVariant, { linter });
      ({ variant, mixed, variantWords } = r);
    }
    if (linter.variant !== variant) await linter.setVariant(variant);

    const locked = new Map<number, Span[]>();
    for (const p of paras) locked.set(p.id, [...findLockedSpans(p.text), ...(p.locked ?? [])]);
    const preset = PRESETS[opts.preset];
    const ctx: TierContext = { locked, variantWords, preset, userTierOverrides: opts.tierOverrides };

    const session = new CheckSession(paras, variant, mixed, ctx, deps.now ?? (() => new Date()));

    const found: Candidate[] = await linter.lintParagraphs(paras, opts.language);
    for (const p of paras) {
      found.push(...findInvisible(p));
      if (preset.extraRules.includes('contractions')) found.push(...findContractions(p));
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
    const tiers = new Map<string, Tier>();
    for (const c of this.cands.values()) {
      if (this.status.get(c.id) !== 'pending' || this.unplaceable.has(c.id)) continue;
      const t = this.tiers.get(c.id)!;
      if (t === 'hidden') continue;
      pending.push(c);
      // A safe candidate is only pending after being undone twice: offer it for review.
      tiers.set(c.id, t === 'safe' ? 'review' : t);
    }
    const { decisions } = buildDecisions(pending, tiers);
    return { top: decisions.slice(0, TOP), more: decisions.slice(TOP) };
  }

  decisionCount(): number {
    return this.decisions().top.length;
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

  accept(decisionId: string, replacementIndex = 0): void {
    const members = this.members(decisionId);
    for (const c of members) {
      if (c.replacements[replacementIndex] === undefined) {
        throw new Error(`candidate ${c.id} has no replacement at index ${replacementIndex}`);
      }
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

  /** applied → rejected; rejected (by the user) → pending. */
  undo(candidateId: string): void {
    const s = this.status.get(candidateId);
    if (s === 'applied') {
      this.replacement.delete(candidateId);
      this.autoApplied.delete(candidateId);
      this.userRejected.add(candidateId);
      this.record(candidateId, 'rejected', false, 'undone');
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
        if (this.tiers.get(c.id) === 'safe') this.tiers.set(c.id, 'review');
      }
    }
  }

  /** The adapter could not write this edit into the document: it leaves the output. */
  markUnplaceable(candidateId: string, reason: string): void {
    if (!this.cands.has(candidateId)) throw new Error(`unknown candidate ${candidateId}`);
    this.unplaceable.set(candidateId, reason);
    this.record(candidateId, 'rejected', this.autoApplied.has(candidateId), `unplaceable: ${reason}`);
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
      this.replacement.delete(old.id);
      this.record(old.id, 'superseded', false, `superseded by ${c.id}`);
    }
    this.replacement.set(c.id, replacement);
    if (auto) this.autoApplied.add(c.id);
    this.record(c.id, 'applied', auto);
  }

  private record(candidateId: string, status: Status, auto: boolean, reason?: string): void {
    this.status.set(candidateId, status);
    if (reason) this.reasons.set(candidateId, reason);
    else this.reasons.delete(candidateId);
    const e: LogEntry = { candidateId, status, auto, at: this.now().toISOString() };
    if (reason) e.reason = reason;
    this.entries.push(e);
  }
}
