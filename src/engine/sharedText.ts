import { findInvisible } from './hygiene';
import { findLockedText } from './lockedText';
import type { CheckOptions } from './sessionTypes';
import type { Candidate, Paragraph, Span } from './types';

/** What the session finds once for the whole document, before any engine runs (spec "Single lock pass"). */
export interface SharedText {
  /** paraId → locked spans (findLockedText over the English paragraphs, then over all the others). */
  locked: Map<number, Span[]>;
  /** findLockedText's command text: surely and maybe, by paraId. */
  commands: { surely: Map<number, Span[]>; maybe: Map<number, Span[]> };
  /** paraId → invisible-character candidates (findInvisible with that paragraph's locks). */
  invisible: Map<number, Candidate[]>;
}

const mergeMaps = <V>(a: Map<number, V>, b: Map<number, V>) => new Map([...a, ...b]);

/** Locks and invisible characters for every paragraph, so each engine gets the same ones instead of finding its own. */
export function findSharedText(
  paras: Paragraph[],
  language: CheckOptions['language'],
  englishParagraphIds: ReadonlySet<number>,
): SharedText {
  // Owner 2026-11-06: English locks must match an English-only reading (command continuations and fences carry across lines).
  const english = findLockedText(paras.filter((p) => englishParagraphIds.has(p.id)), language);
  const others = findLockedText(paras.filter((p) => !englishParagraphIds.has(p.id)), language);
  const locked = mergeMaps(english.locked, others.locked);
  const commands = {
    surely: mergeMaps(english.commands.surely, others.commands.surely),
    maybe: mergeMaps(english.commands.maybe, others.commands.maybe),
  };
  const invisible = new Map(paras.map((p) => [p.id, findInvisible(p, locked.get(p.id))]));
  return { locked, commands, invisible };
}
