import { findInvisible } from './hygiene';
import { findLockedText } from './lockedText';
import type { CheckOptions } from './sessionTypes';
import type { Candidate, Paragraph, Span } from './types';

/** What the session finds once for the whole document, before any engine runs (spec "Single lock pass"). */
export interface SharedText {
  /** paraId → locked spans (findLockedText over the whole document). */
  locked: Map<number, Span[]>;
  /** findLockedText's command text: surely and maybe, by paraId. */
  commands: { surely: Map<number, Span[]>; maybe: Map<number, Span[]> };
  /** paraId → invisible-character candidates (findInvisible with that paragraph's locks). */
  invisible: Map<number, Candidate[]>;
}

/** Locks and invisible characters for every paragraph, so each engine gets the same ones instead of finding its own. */
export function findSharedText(paras: Paragraph[], language: CheckOptions['language']): SharedText {
  const { locked, commands } = findLockedText(paras, language);
  const invisible = new Map(paras.map((p) => [p.id, findInvisible(p, locked.get(p.id))]));
  return { locked, commands, invisible };
}
