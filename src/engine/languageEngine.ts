import type { CheckOptions } from './sessionTypes';
import type { SharedText } from './sharedText';
import type { Candidate, Paragraph } from './types';

/** Every engine the app has; a new engine adds its id here, and the UI's label table then needs a row. */
export type EngineId = 'en' | 'hi' | 'none';

/** How far an engine's fixes are trusted (spec G2). Data only; the shared tier code switches on these values. */
export interface TrustPolicy {
  /** May a fix in this engine's paragraphs be applied without a click (isZeroClickChange still decides which). */
  zeroClick: boolean;
  /** 'english': today's baseTier rules. 'layoutOnly': safe only for hygiene and the shared double-space fix. */
  safeKinds: 'english' | 'layoutOnly';
  /** Which card fixes may start ticked: English's slip-doubling allowlist, or none. */
  ticks: 'slipDoublings' | 'none';
}

/** What an engine can do, for the UI to word its labels and pickers (#2b), and how far its fixes are trusted. */
export interface EngineCapabilities {
  /** 'en' for English, 'hi' for Hindi, 'none' for the not-checked engine; the UI maps it to a label (the engine names no UI key). */
  id: EngineId;
  /** False when the engine checks nothing: its paragraphs are marked "Not checked" (#2a). */
  proofreads: boolean;
  /** The written forms the engine offers, defined by the engine (English: American, British, …). */
  variants: readonly string[];
  /** Whether the script has upper and lower case. */
  hasCase: boolean;
  /** The Unicode script it proofreads ('Latin', 'Devanagari'); null for the not-checked engine. */
  script: string | null;
  /** The spoken language, BCP-47 base ('en', 'hi'); null for the not-checked engine. */
  language: string | null;
  trust: TrustPolicy;
}

/** What every engine reports for the paragraphs it was given. */
export interface EngineResult {
  found: Candidate[];
  /** Paragraph ids the engine could not check (the linter threw on them), in document order. */
  uncheckedParagraphs: number[];
}

/** One language's proofreading: checks the paragraphs routed to it, and learns the user's dictionary words. */
export interface LanguageEngine<Result extends EngineResult = EngineResult> {
  readonly capabilities: EngineCapabilities;
  /**
   * `shared`: the session's locks and invisible characters for the whole document (findSharedText); an engine uses
   * them instead of finding its own. `pause` is SessionDeps.pause: called between chunks of a long check, and may
   * throw to stop it.
   */
  check(paras: Paragraph[], opts: CheckOptions, shared: SharedText, pause?: () => Promise<void>): Promise<Result>;
  addWords(words: string[]): Promise<void>;
}
