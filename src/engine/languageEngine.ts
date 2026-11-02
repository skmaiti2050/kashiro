import type { CheckOptions } from './sessionTypes';
import type { Candidate, Paragraph } from './types';

/** Every engine the app has; a new engine adds its id here, and the UI's label table then needs a row. */
export type EngineId = 'en' | 'none';

/** What an engine can do, for the UI to word its labels and pickers (#2b). */
export interface EngineCapabilities {
  /** 'en' for English, 'none' for the not-checked engine; the UI maps it to a label (the engine names no UI key). */
  id: EngineId;
  /** False when the engine checks nothing: its paragraphs are marked "Not checked" (#2a). */
  proofreads: boolean;
  /** The written forms the engine offers, defined by the engine (English: American, British, …). */
  variants: readonly string[];
  /** Whether the script has upper and lower case. */
  hasCase: boolean;
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
  /** `pause` is SessionDeps.pause: called between chunks of a long check, and may throw to stop it. */
  check(paras: Paragraph[], opts: CheckOptions, pause?: () => Promise<void>): Promise<Result>;
  addWords(words: string[]): Promise<void>;
}
