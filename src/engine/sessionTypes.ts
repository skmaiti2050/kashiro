import type { ReviewDepth } from './depth';
import type { RulesLinter } from './linter';
import type { PresetId } from './presets';
import type { Candidate, Span, Tier, Variant } from './types';

export interface CheckOptions {
  preset: PresetId;
  /** When given, variant detection is skipped. */
  variant?: Variant;
  fallbackVariant: Variant;
  language: 'plaintext' | 'markdown';
  dictionary: string[];
  /** Per-kind tier overrides (passed to TierContext.userTierOverrides). */
  tierOverrides?: Partial<Record<string, Tier>>;
  /** How many decisions to show up front and rewrites to run automatically (default 'standard'). */
  depth?: ReviewDepth;
  /** Uses after which an unknown lowercase word goes on the terms card (spec §5): 2–5, default 3. */
  termMinRepeats?: number;
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

/** Overlap of two edits; zero-width spans clash when they sit at the same point or inside the other. */
export function overlaps(a: Span, b: Span): boolean {
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  if (a.start === a.end) return b.start < a.start && a.start < b.end;
  if (b.start === b.end) return a.start < b.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

export const byPosition = (a: { paraId: number; span: Span }, b: { paraId: number; span: Span }) =>
  a.paraId - b.paraId || a.span.start - b.span.start || a.span.end - b.span.end;
