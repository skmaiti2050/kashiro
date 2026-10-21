import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { ReviewProgress } from './progress';
import { suggestionSpeech } from './readAloud';

/** The current card's screen-reader name: "Card 2 of 9. Correctness, Spelling. Change “recieve” to “receive”. …" */
export function cardLabel(decision: Decision, first: Candidate, position: number, total: number): string {
  return `Card ${position} of ${total}. ${suggestionSpeech(decision, first)}`;
}

/** The polite announcement after a decision: "Accepted. 4 of 9 left." or "Rejected. All reviewed." */
export function afterAction(verb: string, progress: ReviewProgress): string {
  return `${verb}. ${progress.left > 0 ? `${progress.left} of ${progress.total} left` : 'All reviewed'}.`;
}
