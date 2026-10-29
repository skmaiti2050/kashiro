import { createLinter, type RulesLinter } from './linter';
import type { Paragraph, Variant } from './types';
import { lintInChunks } from './chunks';

const ORDER: Variant[] = ['American', 'British', 'Canadian', 'Australian', 'Indian'];

interface VariantResult {
  variant: Variant;
  /** True when the chosen variant still flags words that another variant accepts. */
  mixed: boolean;
  /** Lowercased words flagged as Spelling under the chosen variant but accepted by another. */
  variantWords: Set<string>;
  /** True when the spelling told no variant apart (all tied) and the fallback was taken: "default", not "detected". */
  fromFallback: boolean;
}

/**
 * Lint with each dialect, pick the one with the fewest Spelling lints.
 * Ties: `fallback` if tied, else the first in ORDER. Uses the linter's
 * spell-check-only pass per dialect; a caller-supplied linter keeps its variant.
 * `opts.variant` skips the choice but still computes `variantWords`/`mixed` for it.
 */
export async function detectVariant(
  paras: Paragraph[],
  fallback: Variant,
  opts: { linter?: RulesLinter; variant?: Variant; pause?: () => Promise<void> } = {},
): Promise<VariantResult> {
  const linter = opts.linter ?? (await createLinter(fallback));
  const flagged = new Map<Variant, Set<string>>();
  const counts = new Map<Variant, number>();
  for (const v of ORDER) {
    // A long text is read a chunk at a time, with `pause` between (lintInChunks, Task F20 item 6).
    // A paragraph the linter throws on only leaves out its words here; the main pass reports it as unchecked.
    const cands = await lintInChunks(paras, (chunk) => linter.lintSpelling(chunk, v), () => {}, opts.pause);
    const spelling = cands.filter((c) => c.kind === 'Spelling');
    counts.set(v, spelling.length);
    flagged.set(v, new Set(spelling.map((c) => c.original.toLowerCase())));
  }

  const min = Math.min(...counts.values());
  const tied = ORDER.filter((v) => counts.get(v) === min);
  const variant = opts.variant ?? (tied.includes(fallback) ? fallback : tied[0]);

  const variantWords = new Set<string>();
  for (const w of flagged.get(variant)!) {
    if (ORDER.some((v) => v !== variant && !flagged.get(v)!.has(w))) variantWords.add(w);
  }
  const fromFallback = !opts.variant && tied.length === ORDER.length;
  return { variant, mixed: variantWords.size > 0, variantWords, fromFallback };
}
