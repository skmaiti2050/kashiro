import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { msg, type Message } from '../i18n/message';
import type { Translator } from '../i18n/translator';
import type { ReviewProgress } from './progress';
import { suggestionSpeech } from './readAloud';

/**
 * The current card's screen-reader name: "Card 2 of 9 left. Correctness: Spelling. Change “recieve” to
 * “receive”. …". "N left" is the same wording the announcements use ("Accepted. 8 of 9 left.").
 */
export function cardLabel(t: Translator, decision: Decision, candidates: Map<string, Candidate>, position: number, left: number): string {
  return t.t('speech.card', { position, left, speech: suggestionSpeech(t, decision, candidates) });
}

/**
 * The check-finished announcement with the "couldn't be checked" note after it when the checker skipped paragraphs
 * (Task F21b E2): the panel shows that note, so a screen-reader user hears it too.
 */
export function withNotChecked(finished: Message, notChecked: number): Message {
  if (notChecked === 0) return finished;
  return msg('announce.withNote', { announcement: finished, note: msg('panel.notChecked', { count: notChecked }) });
}

/** The polite announcement after a decision: "Accepted. 4 of 9 left." or "Rejected. All reviewed." */
export function afterAction(verb: Message, progress: ReviewProgress): Message {
  if (progress.left === 0) return msg('announce.afterAll', { verb });
  return msg('announce.after', { verb, left: progress.left, total: progress.total });
}
