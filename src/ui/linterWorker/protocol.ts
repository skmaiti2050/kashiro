import type { Candidate, Paragraph, Variant } from '../../engine/types';

/** One RulesLinter call, as sent to the Worker that runs Harper. */
export type LinterOperation =
  | { op: 'start'; variant: Variant; words: string[] }
  | { op: 'lintParagraphs'; paras: Paragraph[]; language: 'plaintext' | 'markdown' }
  | { op: 'lintSpelling'; paras: Paragraph[]; variant: Variant }
  | { op: 'addWords'; words: string[] }
  | { op: 'setVariant'; variant: Variant };

/** A call with its id; the reply carries the same id. */
export type LinterRequest = { id: number } & LinterOperation;

export type LinterReply = { id: number; ok: true; candidates?: Candidate[] } | { id: number; ok: false; message: string };
