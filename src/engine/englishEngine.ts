import { createLinter, type RulesLinter } from './linter';
import { detectVariant } from './variant';
import { visibleText, type VisibleText } from './hygiene';
import { withoutCaseOnlyFixOnCommand } from './commands';
import { withTechnicalWordRules } from './technicalWords';
import { lintInChunks } from './chunks';
import { dictionaryMatcher } from './dictionaryWords';
import { WORD_REWRITE_KINDS, withoutNonWordFixes } from './wordFlags';
import { PRESETS } from './presets';
import { findContractions } from './contractions';
import { improveSuggestions, withoutOffensiveSuggestions } from './suggestions/improve';
import { resolveModules } from './modules';
import { findForeignSentences, findRomanisedSentences, loadModelIfNeeded } from './otherLanguage';
import { byPosition, type CheckOptions } from './sessionTypes';
import { findConfusables, replacesLinterFlag } from './confusables';
import type { EngineCapabilities, EngineResult, LanguageEngine } from './languageEngine';
import type { SharedText } from './sharedText';
import type { TierContext } from './tiers';
import type { Candidate, Paragraph, Variant } from './types';

/** What the English engine reports beyond every engine's result: the variant and the tier context of the check. */
export interface EnglishResult extends EngineResult {
  variant: Variant;
  mixedVariant: boolean;
  variantFromFallback: boolean;
  ctx: TierContext;
}

export type EnglishEngine = LanguageEngine<EnglishResult>;

export const ENGLISH_VARIANTS = ['American', 'British', 'Australian', 'Canadian', 'Indian'] as const satisfies readonly Variant[];

export function isVariant(v: string): v is Variant {
  return (ENGLISH_VARIANTS as readonly string[]).includes(v);
}

const ENGLISH_CAPABILITIES: EngineCapabilities = {
  id: 'en',
  proofreads: true,
  variants: ENGLISH_VARIANTS,
  hasCase: true,
  script: 'Latin',
  language: 'en',
  trust: { zeroClick: true, safeKinds: 'english', ticks: 'slipDoublings' },
};

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

/** A linter flag on the visible text, placed on the paragraph's own offsets and text (same id scheme as the linter's). */
function inParagraph(c: Candidate, visible: VisibleText, paragraph: string): Candidate {
  const span = visible.toParagraph(c.span);
  if (span.start === c.span.start && span.end === c.span.end) return c;
  return { ...c, id: `${c.paraId}:${span.start}:${span.end}:${c.kind}`, span, original: paragraph.slice(span.start, span.end) };
}

/**
 * A flag whose span covers a character hygiene keeps (`kept`: a direction control it leaves in place) offers no
 * fix: its replacement was made without that character, so applying it would delete a control the card never
 * showed (Task F4 item 4, F3 re-review 2 I-4).
 */
function withoutFixOverKept(c: Candidate, kept: readonly number[]): Candidate {
  if (!kept.some((i) => c.span.start <= i && i < c.span.end)) return c;
  return { ...c, replacements: [], linterReplacements: undefined };
}

/**
 * English proofreading: Harper (`linter`) plus the follow-up passes, over the paragraphs routed to English.
 * Without `linter` the first check creates one (the UI passes one built with the browser binary).
 */
export function createEnglishEngine(linter?: RulesLinter): EnglishEngine {
  const injected = linter !== undefined;
  let current = linter;
  return {
    capabilities: ENGLISH_CAPABILITIES,
    async check(paras, opts, shared, pause) {
      current ??= await createLinter(opts.variant ?? opts.fallbackVariant, opts.dictionary);
      if (injected && opts.dictionary.length) await syncDictionary(current, opts.dictionary);
      return checkEnglish(paras, opts, shared, current, pause);
    },
    async addWords(words) {
      if (!current) throw new Error('The English engine has no linter yet: run a check before adding words.');
      await current.addWords(words);
    },
  };
}

async function checkEnglish(
  paras: Paragraph[],
  opts: CheckOptions,
  shared: SharedText,
  linter: RulesLinter,
  pause: (() => Promise<void>) | undefined,
): Promise<EnglishResult> {
  const { locked, invisible } = shared;
  const { surely: commandSpans, maybe: maybeCommandSpans } = shared.commands;
  // The linter reads each paragraph without its invisible junk; its spans are mapped back below. The session adds
  // the invisible-character fixes themselves, for every engine's paragraphs.
  const visible = new Map(paras.map((p) => [p.id, visibleText(p, invisible.get(p.id)!)]));
  const asSeen = paras.map((p) => ({ ...p, text: visible.get(p.id)!.text }));

  // With an explicit variant, detection still runs to compute its variantWords (never auto-converted).
  const { variant, mixed, variantWords, fromFallback } = await detectVariant(asSeen, opts.fallbackVariant, {
    linter,
    variant: opts.variant,
    pause,
  });
  if (linter.variant !== variant) await linter.setVariant(variant);

  const preset = PRESETS[opts.preset];
  const paraText = new Map(paras.map((p) => [p.id, p.text]));
  const modules = resolveModules(opts.modules);

  const kept = new Map(paras.map((p) => [p.id, invisible.get(p.id)!.filter((c) => c.replacements.length === 0).map((c) => c.span.start)]));
  const uncheckedParagraphs: number[] = [];
  const lint = (chunk: Paragraph[]) => linter.lintParagraphs(chunk, opts.language);
  const linted: Candidate[] = (await lintInChunks(asSeen, lint, (p) => uncheckedParagraphs.push(p.id), pause))
    .map((c) => inParagraph(c, visible.get(c.paraId)!, paraText.get(c.paraId)!))
    .map((c) =>
      modules.betterSuggestions ? improveSuggestions(c, paraText.get(c.paraId), locked.get(c.paraId)) : withoutOffensiveSuggestions(c),
    )
    .map((c) => withoutFixOverKept(c, kept.get(c.paraId)!))
    .map(withoutNonWordFixes)
    .map((c) => withoutCaseOnlyFixOnCommand(c, commandSpans.get(c.paraId)))
    .flatMap((c) => withTechnicalWordRules(c, commandSpans.get(c.paraId), maybeCommandSpans.get(c.paraId)) ?? []);
  const confusables = paras.flatMap((p) => findConfusables(p, locked.get(p.id)));
  // The curated rule knows these words better than the linter ("intercast" → "inter cast"): its flag replaces the linter's word flag there.
  // A word the user's dictionary accepts is never flagged: Harper misses "VANTIX" for the entry "Vantix" (F20 item 9b).
  const inDictionary = dictionaryMatcher(opts.dictionary);
  const found = linted.filter((c) => !confusables.some((x) => replacesLinterFlag(x, c)) && !(WORD_REWRITE_KINDS.has(c.kind) && inDictionary(c.original)));
  found.push(...confusables);
  if (preset.extraRules.includes('contractions')) found.push(...paras.flatMap((p) => findContractions(p, locked.get(p.id))));
  found.sort(byPosition);
  // The classifier also drives the never-auto-fix guard (a core protection), so it loads whatever the card switch says.
  await loadModelIfNeeded(found);
  const foreignSentences = findForeignSentences(found, paraText);
  const romanisedSentences = findRomanisedSentences(found, paraText);
  const ctx: TierContext = {
    modules,
    locked,
    commandSpans,
    maybeCommandSpans,
    variantWords,
    preset,
    userTierOverrides: opts.tierOverrides,
    ignoredKinds: new Set(opts.ignoredRules ?? []),
    paraText,
    variant,
    foreignSentences,
    romanisedSentences,
    listParagraphs: new Set(paras.filter((p) => p.listItem).map((p) => p.id)),
  };
  return { variant, mixedVariant: mixed, variantFromFallback: fromFallback, ctx, found, uncheckedParagraphs, foreignSentences };
}
