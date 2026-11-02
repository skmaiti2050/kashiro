import type { CheckSession } from '@/engine/session';

/** Something the check did not read: a whole paragraph set aside (#2a) or a passage inside a checked one (#29). */
export interface UncheckedPlace {
  paraId: number;
  /** Where to scroll to in the paragraph: its start for a set-aside paragraph, the passage's start otherwise. */
  offset: number;
}

/** Every set-aside paragraph and passage, in document order: "Show next" steps through this list. */
export function uncheckedPlaces(session: CheckSession): UncheckedPlace[] {
  const order = new Map(session.paragraphs().map((p, index) => [p.id, index]));
  const places = [
    ...session.otherScriptParagraphs().map((paraId) => ({ paraId, offset: 0 })),
    ...session.uncheckedPassages().map((p) => ({ paraId: p.paraId, offset: p.span.start })),
  ];
  // A set-aside paragraph has no passages, so no two places share a paragraph and offset.
  return places.sort((a, b) => order.get(a.paraId)! - order.get(b.paraId)! || a.offset - b.offset);
}
