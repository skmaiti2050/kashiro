import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import type { ReviewProgress } from './progress';
import { suggestionSpeech } from './readAloud';

/**
 * The current card's screen-reader name: "Card 2 of 9 left. Correctness: Spelling. Change “recieve” to
 * “receive”. …". "N left" is the same wording the announcements use ("Accepted. 8 of 9 left.").
 */
export function cardLabel(decision: Decision, first: Candidate, position: number, left: number): string {
  return `Card ${position} of ${left} left. ${suggestionSpeech(decision, first)}`;
}

/** The polite announcement after a decision: "Accepted. 4 of 9 left." or "Rejected. All reviewed." */
export function afterAction(verb: string, progress: ReviewProgress): string {
  return `${verb}. ${progress.left > 0 ? `${progress.left} of ${progress.total} left` : 'All reviewed'}.`;
}
