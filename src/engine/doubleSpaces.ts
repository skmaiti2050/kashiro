import { overlaps } from './sessionTypes';
import type { Candidate, Paragraph, Span } from './types';

/** Two or more plain spaces between two non-space characters: "  " in "यह  परीक्षण". */
const SPACES_BETWEEN_WORDS = /(?<=\S) {2,}(?=\S)/g;

/**
 * Runs of spaces between words, as the shared layout fix for engines without Harper (spec "Settled after the
 * builder check"): the same shape, id and message as Harper's own double-space lint, so tierOf and the card treat
 * them alike. Whether one is applied without a click is still isZeroClickChange's call (layout, keys and values).
 */
export function findDoubleSpaces(p: Paragraph, locked: readonly Span[] | undefined): Candidate[] {
  const out: Candidate[] = [];
  for (const m of p.text.matchAll(SPACES_BETWEEN_WORDS)) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (locked?.some((s) => overlaps(span, s))) continue;
    out.push({
      id: `${p.id}:${span.start}:${span.end}:Formatting`,
      paraId: p.id,
      span,
      original: m[0],
      replacements: [' '],
      kind: 'Formatting',
      message: `There are ${m[0].length} spaces where there should be only one.`,
      source: 'rules',
    });
  }
  return out;
}
