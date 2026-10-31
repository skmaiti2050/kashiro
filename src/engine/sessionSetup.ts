import { createLinter, type RulesLinter } from './linter';
import { detectVariant } from './variant';
import { findInvisible, visibleText, type VisibleText } from './hygiene';
import { definedLinkLabels, findLockedSpans } from './factLock';
import { findCommandText, withoutCaseOnlyFixOnCommand } from './commands';
import { withTechnicalWordRules } from './technicalWords';
import { lintInChunks } from './chunks';
import { dictionaryMatcher } from './dictionaryWords';
import { WORD_REWRITE_KINDS, withoutNonWordFixes } from './wordFlags';
import { PRESETS } from './presets';
import { findContractions } from './contractions';
import { improveSuggestions, withoutOffensiveSuggestions } from './suggestions/improve';
import { resolveModules } from './modules';
import { findForeignSentences, findRomanisedSentences, loadModelIfNeeded } from './otherLanguage';
import { byPosition, type CheckOptions, type SessionDeps } from './sessionTypes';
import { findConfusables, replacesLinterFlag } from './confusables';
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

/** Everything a session needs before it takes over: the linter, variant, tier context and the sorted candidates. */
export async function prepareCheck(
  paras: Paragraph[],
  opts: CheckOptions,
  deps: SessionDeps,
): Promise<{
  linter: RulesLinter;
  variant: Variant;
  mixedVariant: boolean;
  variantFromFallback: boolean;
  ctx: TierContext;
  found: Candidate[];
  /** Paragraph ids the linter threw on (lintInChunks). */
  uncheckedParagraphs: number[];
}> {
  const linter = deps.linter ?? (await createLinter(opts.variant ?? opts.fallbackVariant, opts.dictionary));
  if (deps.linter && opts.dictionary.length) await syncDictionary(linter, opts.dictionary);

  // Commands are fact-locked too (never auto-applied, spelling asked on its own card); tierOf also hides every
  // other rule's flag on them (Task F20 item 1).
  const { surely: commandSpans, maybe: maybeCommandSpans } = findCommandText(paras);
  const locked = new Map<number, Span[]>();
  // Link labels are Markdown only: in .txt and .docx "[the the]" is ordinary text.
  const linkLabels = opts.language === 'markdown' ? definedLinkLabels(paras.map((p) => p.text)) : undefined;
  for (const p of paras) locked.set(p.id, [...findLockedSpans(p.text, linkLabels), ...commandSpans.get(p.id)!, ...(p.locked ?? [])]);
  // The linter reads each paragraph without its invisible junk; its spans are mapped back below.
  const invisible = new Map(paras.map((p) => [p.id, findInvisible(p, locked.get(p.id))]));
  const visible = new Map(paras.map((p) => [p.id, visibleText(p, invisible.get(p.id)!)]));
  const asSeen = paras.map((p) => ({ ...p, text: visible.get(p.id)!.text }));

  // With an explicit variant, detection still runs to compute its variantWords (never auto-converted).
  const { variant, mixed, variantWords, fromFallback } = await detectVariant(asSeen, opts.fallbackVariant, {
    linter,
    variant: opts.variant,
    pause: deps.pause,
  });
  if (linter.variant !== variant) await linter.setVariant(variant);

  const preset = PRESETS[opts.preset];
  const paraText = new Map(paras.map((p) => [p.id, p.text]));
  const modules = resolveModules(opts.modules);

  const kept = new Map(paras.map((p) => [p.id, invisible.get(p.id)!.filter((c) => c.replacements.length === 0).map((c) => c.span.start)]));
  const uncheckedParagraphs: number[] = [];
  const lint = (chunk: Paragraph[]) => linter.lintParagraphs(chunk, opts.language);
  const linted: Candidate[] = (await lintInChunks(asSeen, lint, (p) => uncheckedParagraphs.push(p.id), deps.pause))
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
  for (const p of paras) {
    found.push(...invisible.get(p.id)!);
    if (preset.extraRules.includes('contractions')) found.push(...findContractions(p, locked.get(p.id)));
  }
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
  return { linter, variant, mixedVariant: mixed, variantFromFallback: fromFallback, ctx, found, uncheckedParagraphs };
}
