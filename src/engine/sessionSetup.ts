import { createLinter, type RulesLinter } from './linter';
import { detectVariant } from './variant';
import { findInvisible } from './hygiene';
import { findLockedSpans } from './factLock';
import { PRESETS } from './presets';
import { findContractions } from './contractions';
import { improveSuggestions } from './suggestions/improve';
import { findForeignSentences, loadModelIfNeeded } from './otherLanguage';
import { byPosition, type CheckOptions, type SessionDeps } from './sessionTypes';
import type { TierContext } from './tiers';
import type { Candidate, Paragraph, Span, Variant } from './types';

/** Words already added to a reused linter, so a second session does not add them again. */
const addedWords = new WeakMap<RulesLinter, Set<string>>();

async function syncDictionary(linter: RulesLinter, dictionary: string[]): Promise<void> {
  const seen = addedWords.get(linter) ?? new Set<string>();
  addedWords.set(linter, seen);
  const fresh = dictionary.filter((w) => !seen.has(w));
  if (!fresh.length) return;
  await linter.addWords(fresh);
  fresh.forEach((w) => seen.add(w));
}

/** Everything a session needs before it takes over: the linter, variant, tier context and the sorted candidates. */
export async function prepareCheck(
  paras: Paragraph[],
  opts: CheckOptions,
  deps: SessionDeps,
): Promise<{ linter: RulesLinter; variant: Variant; mixedVariant: boolean; ctx: TierContext; found: Candidate[] }> {
  const linter = deps.linter ?? (await createLinter(opts.variant ?? opts.fallbackVariant, opts.dictionary));
  if (deps.linter && opts.dictionary.length) await syncDictionary(linter, opts.dictionary);

  // With an explicit variant, detection still runs to compute its variantWords (never auto-converted).
  const { variant, mixed, variantWords } = await detectVariant(paras, opts.fallbackVariant, {
    linter,
    variant: opts.variant,
  });
  if (linter.variant !== variant) await linter.setVariant(variant);

  const locked = new Map<number, Span[]>();
  for (const p of paras) locked.set(p.id, [...findLockedSpans(p.text), ...(p.locked ?? [])]);
  const preset = PRESETS[opts.preset];
  const paraText = new Map(paras.map((p) => [p.id, p.text]));

  const found: Candidate[] = (await linter.lintParagraphs(paras, opts.language)).map((c) =>
    improveSuggestions(c, paraText.get(c.paraId), locked.get(c.paraId)),
  );
  for (const p of paras) {
    found.push(...findInvisible(p));
    if (preset.extraRules.includes('contractions')) found.push(...findContractions(p, locked.get(p.id)));
  }
  found.sort(byPosition);
  await loadModelIfNeeded(found);
  const foreignSentences = findForeignSentences(found, paraText);
  const ctx: TierContext = { locked, variantWords, preset, userTierOverrides: opts.tierOverrides, paraText, variant, foreignSentences };
  return { linter, variant, mixedVariant: mixed, ctx, found };
}
