import { createLinter, type RulesLinter } from './linter';
import type { Paragraph, Variant } from './types';

const ORDER: Variant[] = ['American', 'British', 'Canadian', 'Australian', 'Indian'];

export interface VariantResult {
  variant: Variant;
  /** True when the chosen variant still flags words that another variant accepts. */
  mixed: boolean;
  /** Lowercased words flagged as Spelling under the chosen variant but accepted by another. */
  variantWords: Set<string>;
}

/**
 * Lint with each dialect, pick the one with the fewest Spelling lints.
 * Ties: `fallback` if tied, else the first in ORDER. One linter is reused
 * via setVariant; a caller-supplied linter gets its original variant back.
 */
export async function detectVariant(
  paras: Paragraph[],
  fallback: Variant,
  opts: { linter?: RulesLinter } = {},
): Promise<VariantResult> {
  const linter = opts.linter ?? (await createLinter(fallback));
  const original = linter.variant;

  const flagged = new Map<Variant, Set<string>>();
  const counts = new Map<Variant, number>();
  try {
    for (const v of ORDER) {
      await linter.setVariant(v);
      const cands = await linter.lintParagraphs(paras, 'plaintext');
      const spelling = cands.filter((c) => c.kind === 'Spelling');
      counts.set(v, spelling.length);
      flagged.set(v, new Set(spelling.map((c) => c.original.toLowerCase())));
    }
  } finally {
    if (opts.linter) await linter.setVariant(original);
  }

  const min = Math.min(...counts.values());
  const tied = ORDER.filter((v) => counts.get(v) === min);
  const variant = tied.includes(fallback) ? fallback : tied[0];

  const variantWords = new Set<string>();
  for (const w of flagged.get(variant)!) {
    if (ORDER.some((v) => v !== variant && !flagged.get(v)!.has(w))) variantWords.add(w);
  }
  return { variant, mixed: variantWords.size > 0, variantWords };
}
