/** A rough pace for the time estimate: read the card, glance at the text, decide. */
const SECONDS_PER_DECISION = 10;

export interface ReviewProgress {
  /** Decisions in the up-front queue. */
  left: number;
  /** Left plus the decisions made since the document was opened. */
  total: number;
  /** Rough minutes to go, rounded up. */
  minutes: number;
}

export function reviewProgress(left: number, decided: number): ReviewProgress {
  return { left, total: left + decided, minutes: Math.ceil((left * SECONDS_PER_DECISION) / 60) };
}

/** "4 of 9 left · ~1 min", or a Done line. Deliberately no score (UI/UX research: score anxiety). */
export function progressLabel({ left, total, minutes }: ReviewProgress): string {
  if (left > 0) return `${left} of ${total} left · ~${minutes} min`;
  if (total === 0) return 'Done: nothing to decide';
  return `Done: ${total} ${total === 1 ? 'decision' : 'decisions'} made`;
}
