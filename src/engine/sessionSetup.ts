import { createEnglishEngine, type EnglishResult } from './englishEngine';
import { findDoubleSpaces } from './doubleSpaces';
import { findSharedText, type SharedText } from './sharedText';
import { notCheckedEngine } from './notCheckedEngine';
import type { EngineResult, LanguageEngine } from './languageEngine';
import { byPosition, type CheckOptions, type SessionDeps } from './sessionTypes';
import { ENGLISH_SCRIPT, dominantScript, majorityScript, otherScriptParagraphIds } from './uncheckedScripts';
import type { TierContext } from './tiers';
import type { Candidate, Paragraph, Span } from './types';

/**
 * One proofreading engine per document (owner, 2026-11-02): the engine registered for the script most of the
 * document is written in (majorityScript), else English. It checks the paragraphs in its language; every other
 * paragraph goes to the not-checked engine, English ones included when another engine proofreads the document.
 */
function routeParagraphs(
  paras: Paragraph[],
  english: LanguageEngine,
  scriptEngines: ReadonlyMap<string, LanguageEngine>,
): { proofreader: LanguageEngine; proofreaderScript: string; paragraphEngines: Map<number, LanguageEngine> } {
  // A paragraph no engine proofreads gets no candidate of any kind (never damage).
  const setAside = new Set(otherScriptParagraphIds(paras));
  const script = scriptEngines.size > 0 ? majorityScript(paras.map((p) => p.text), scriptEngines.keys()) : undefined;
  const scriptEngine = script === undefined ? undefined : scriptEngines.get(script);
  if (!scriptEngine) {
    return { proofreader: english, proofreaderScript: ENGLISH_SCRIPT, paragraphEngines: new Map(paras.map((p) => [p.id, setAside.has(p.id) ? notCheckedEngine : english])) };
  }
  const inScript = (p: Paragraph) => setAside.has(p.id) && dominantScript(p.text, scriptEngines.keys()) === script;
  const paragraphEngines = new Map(paras.map((p) => [p.id, inScript(p) ? scriptEngine : notCheckedEngine]));
  return { proofreader: scriptEngine, proofreaderScript: script!, paragraphEngines };
}

/**
 * Everything a session needs before it takes over: the engine of each paragraph, the English variant and tier
 * context, and the sorted candidates.
 */
export async function prepareCheck(
  allParas: Paragraph[],
  opts: CheckOptions,
  deps: SessionDeps,
): Promise<
  EnglishResult & {
    /** The engine that checked each paragraph, by paragraph id. */
    paragraphEngines: Map<number, LanguageEngine>;
    /** Every engine that ran, English first (it runs even with no paragraph of its own). */
    engines: LanguageEngine[];
    /** The document's one proofreading engine. */
    proofreader: LanguageEngine;
    /** The Unicode script the proofreader checks: 'Latin' for English, else the `scriptEngines` key that won. */
    proofreaderScript: string;
    /** The proofreader's foreign sentences (mostly another language), by paragraph id. */
    foreignSentences: Map<number, Span[]>;
  }
> {
  const english = createEnglishEngine(deps.linter);
  const { proofreader, proofreaderScript, paragraphEngines } = routeParagraphs(allParas, english, deps.scriptEngines ?? new Map());
  const parasOf = (engine: LanguageEngine) => allParas.filter((p) => paragraphEngines.get(p.id) === engine);
  // One lock pass for the whole document (#1 gate 1): every engine's paragraphs get the same locked text as English
  // ones (URLs, numbers, quotes, commands, adapter locks).
  const shared = findSharedText(allParas, opts.language);
  // English always runs, even with no paragraph of its own: the session's variant and tier context come from it.
  const fromEnglish = await english.check(parasOf(english), opts, shared, deps.pause);
  const others = [...new Set(paragraphEngines.values())].filter((engine) => engine !== english);
  const fromOthers: EngineResult[] = [];
  for (const engine of others) fromOthers.push(await engine.check(parasOf(engine), opts, shared, deps.pause));
  const proofreaderResult = proofreader === english ? fromEnglish : fromOthers[others.indexOf(proofreader)];

  const fromEngines = [...fromEnglish.found, ...fromOthers.flatMap((r) => r.found)];
  // A stable sort, engines' candidates before the session's own: alone, English's keep the order they always had.
  const found = [...fromEngines, ...layoutFixes(allParas, paragraphEngines, shared, fromEngines)].sort(byPosition);
  // Every engine's unchecked paragraphs, in document order.
  const unchecked = new Set([fromEnglish, ...fromOthers].flatMap((r) => r.uncheckedParagraphs));
  const uncheckedParagraphs = allParas.filter((p) => unchecked.has(p.id)).map((p) => p.id);
  // tierOf tiers every paragraph by its engine's trust policy, and hides every non-spelling flag on a surely-command
  // and keeps maybe-commands from zero-click, whichever engine checked it.
  const ctx: TierContext = {
    ...fromEnglish.ctx,
    locked: shared.locked,
    commandSpans: shared.commands.surely,
    maybeCommandSpans: shared.commands.maybe,
    paragraphEngines: new Map([...paragraphEngines].map(([paraId, engine]) => [paraId, engine.capabilities])),
  };
  return { ...fromEnglish, ctx, paragraphEngines, engines: [english, ...others], proofreader, proofreaderScript, found, uncheckedParagraphs, foreignSentences: proofreaderResult.foreignSentences ?? new Map() };
}

/**
 * The fixes the session finds itself in every paragraph a proofreading engine checks (spec "Settled after the builder
 * check"): invisible characters, and for engines other than English (which keeps Harper's) runs of spaces between
 * words. Set-aside paragraphs get none (never damage). An engine that already reported the same fix keeps its own.
 */
function layoutFixes(
  allParas: Paragraph[],
  paragraphEngines: ReadonlyMap<number, LanguageEngine>,
  shared: SharedText,
  fromEngines: readonly Candidate[],
): Candidate[] {
  const reported = new Set(fromEngines.map((c) => c.id));
  const fixes = allParas.flatMap((p) => {
    const { proofreads, language } = paragraphEngines.get(p.id)!.capabilities;
    if (!proofreads) return [];
    const spaces = language === 'en' ? [] : findDoubleSpaces(p, shared.locked.get(p.id));
    return [...shared.invisible.get(p.id)!, ...spaces];
  });
  return fixes.filter((c) => !reported.has(c.id));
}
