import type { ReviewDepth } from './depth';
import type { EditLedger } from './editLedger';
import type { LanguageEngine } from './languageEngine';
import type { HelperRewrites } from './sessionRewrites';
import type { TierContext } from './tiers';
import type { Candidate, Paragraph, Tier } from './types';

/** CheckSession's private state, shared by its modules (session*.ts). Not an API: nothing else imports it. */
export interface SessionState {
  readonly paras: Map<number, Paragraph>;
  readonly cands: Map<string, Candidate>;
  readonly tiers: Map<string, Tier>;
  readonly ledger: EditLedger;
  readonly ctx: TierContext;
  readonly userRejected: Set<string>;
  readonly unplaceable: Map<string, string>;
  /** Lowercased words the user unticked on a card (names, terms, other languages): real typos, ranked as words. */
  readonly typoWords: Set<string>;
  /** Simple-fixes card members that are there only because the user added their kind in Settings: never ticked. */
  readonly optedIn: Set<string>;
  /** One-line paragraphs lined up with their neighbours (findAlignedParagraphs): their spaces are layout. */
  readonly alignedParas: Set<number>;
  /** Candidate id → the applyBatch it was applied by, while it stays applied. */
  readonly batchOf: Map<string, string>;
  readonly added: string[];
  readonly words: number;
  readonly termMinRepeats: number;
  batchCount: number;
  reviewDepth: ReviewDepth;
  /** Every engine that ran (English always): each learns a word added to the dictionary. */
  engines: readonly LanguageEngine[];
  /** The LLM helper's sentences and rewrites. */
  rewrites: HelperRewrites;
}
