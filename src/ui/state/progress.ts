import type { Translator } from '../i18n/translator';

/** A rough pace for the time estimate: read the card, glance at the text, decide. */
const SECONDS_PER_DECISION = 10;

export interface ReviewProgress {
  /** Ranked decisions still open. */
  left: number;
  /** Left plus the decisions made since the document was opened. */
  total: number;
  /** Rough minutes to go, rounded up. */
  minutes: number;
}

/**
 * Progress for the panel header. "Left" is every ranked decision still open (the up-front queue and the
 * non-blocked "More" rows), not only the queue: the queue refills from "More", so its length alone would
 * read "10 of 11 left" with dozens to go.
 */
export function progressOf(session: { rankedDecisionCount(): number }, decided: number): ReviewProgress {
  return reviewProgress(session.rankedDecisionCount(), decided);
}

export function reviewProgress(left: number, decided: number): ReviewProgress {
  return { left, total: left + decided, minutes: Math.ceil((left * SECONDS_PER_DECISION) / 60) };
}

/** "4 of 9 left · ~1 min", or a Done line. Deliberately no score (UI/UX research: score anxiety). */
export function progressLabel(t: Translator, { left, total, minutes }: ReviewProgress): string {
  if (left > 0) return t.t('progress.left', { left, total, minutes });
  if (total === 0) return t.t('progress.nothing');
  return t.t('progress.done', { count: total });
}
