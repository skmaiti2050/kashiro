/** How much review the user wants up front (spec §5). Never changes what is auto-applied. */
export type ReviewDepth = 'light' | 'standard' | 'thorough' | 'everything';

export const DEFAULT_DEPTH: ReviewDepth = 'standard';

const WORDS_PER_BUDGET = 1500;

interface DepthRates {
  /** Decisions shown up front per 1,500 words; 'all' shows every ranked decision. */
  decisionsPer1500: number | 'all';
  /** Local-LLM rewrites sent automatically per 1,500 words. */
  rewritesPer1500: number;
  /** Rewrites per 1,500 words for an explicit "check more" request. */
  moreRewritesPer1500: number;
}

export const DEPTHS: Record<ReviewDepth, DepthRates> = {
  light: { decisionsPer1500: 5, rewritesPer1500: 1, moreRewritesPer1500: 1 },
  standard: { decisionsPer1500: 10, rewritesPer1500: 3, moreRewritesPer1500: 3 },
  thorough: { decisionsPer1500: 25, rewritesPer1500: 6, moreRewritesPer1500: 6 },
  everything: { decisionsPer1500: 'all', rewritesPer1500: 0, moreRewritesPer1500: 3 },
};

/** Decisions in the default view: at least 1, so a short text never opens empty. */
export function upFrontCount(depth: ReviewDepth, words: number): number {
  const perK = DEPTHS[depth].decisionsPer1500;
  if (perK === 'all') return Infinity;
  return Math.max(1, Math.round((perK * words) / WORDS_PER_BUDGET));
}

/** Whole decisions the document may hold up front (rounded down): the room the first LLM run must leave. */
export function upFrontRoom(depth: ReviewDepth, words: number): number {
  const perK = DEPTHS[depth].decisionsPer1500;
  if (perK === 'all') return Infinity;
  return Math.floor((perK * words) / WORDS_PER_BUDGET);
}

/** Sentences to rewrite per document at this depth; at least 1 unless the rate is 0. */
export function rewriteCount(depth: ReviewDepth, words: number, explicit: boolean): number {
  const perK = explicit ? DEPTHS[depth].moreRewritesPer1500 : DEPTHS[depth].rewritesPer1500;
  if (perK === 0) return 0;
  return Math.max(1, Math.round((perK * words) / WORDS_PER_BUDGET));
}
