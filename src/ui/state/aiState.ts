import type { CheckSession } from '@/engine/session';
import type { Candidate } from '@/engine/types';
import type { Message } from '../i18n/message';

/** The AI group's part of the controller state. */
export interface AiState {
  /** Sentences answered and asked for, while a run lasts (the progress bar). */
  run: { done: number; total: number } | null;
  /** "Check how it reads" ran for this document: the group offers "Check more sentences" now. */
  checkedDocument: boolean;
  /** The group's last word: "No improvement suggested for this sentence", why nothing was sent… */
  notice: Message | null;
  /** A suggestion that came back for "Improve this sentence": the panel brings up its card. `seq` is new each time. */
  ready: { candidateId: string; seq: number } | null;
  /** The first-use speed check is running. */
  measuring: boolean;
}

export const NO_AI: AiState = { run: null, checkedDocument: false, notice: null, ready: null, measuring: false };

/** The AI suggestions waiting for review, in document order. */
export function pendingSuggestions(session: CheckSession): Candidate[] {
  return session
    .outcomes()
    .filter((o) => o.candidate.source === 'llm' && o.status === 'pending' && o.unplaceable === undefined)
    .map((o) => o.candidate);
}
