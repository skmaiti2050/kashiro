/** What the cursor needs of a decision. */
interface Card {
  id: string;
  candidateIds: string[];
}

/**
 * The current card: its id, and its place in the up-front queue. When the card is decided it leaves
 * the queue, and the card that slid into its place becomes current (Enter-Enter-Enter walks the queue).
 */
export interface ReviewCursor {
  id: string | null;
  index: number;
}

export const START: ReviewCursor = { id: null, index: 0 };

/** The current card: the cursor's card (in the queue or picked from "More"), else the one now at its place. */
export function currentDecision<T extends Card>(top: T[], more: T[], cursor: ReviewCursor): T | undefined {
  const own = top.find((d) => d.id === cursor.id) ?? more.find((d) => d.id === cursor.id);
  if (own) return own;
  return top[Math.min(cursor.index, top.length - 1)];
}

/** J / K: the next or previous card in the queue, wrapping around. From a "More" card, J goes back into the queue. */
export function moveCursor(top: Card[], more: Card[], cursor: ReviewCursor, step: 1 | -1): ReviewCursor {
  if (top.length === 0) return cursor;
  const current = currentDecision(top, more, cursor);
  const at = top.findIndex((d) => d.id === current?.id);
  const index = at < 0 ? Math.min(cursor.index, top.length - 1) : (at + step + top.length) % top.length;
  return { id: top[index].id, index };
}

/** Makes `decisionId` current (a "More" row, or a clicked underline); a "More" card keeps the queue place. */
export function cursorAt(top: Card[], decisionId: string, from: ReviewCursor = START): ReviewCursor {
  const index = top.findIndex((d) => d.id === decisionId);
  return { id: decisionId, index: index < 0 ? from.index : index };
}

/** The decision that holds `candidateId`, in the queue or under "More". */
export function decisionWith<T extends Card>(top: T[], more: T[], candidateId: string): T | undefined {
  return [...top, ...more].find((d) => d.candidateIds.includes(candidateId));
}
