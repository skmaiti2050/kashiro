import { createEnglishEngine, type EnglishResult } from './englishEngine';
import { findLockedText } from './lockedText';
import { notCheckedEngine } from './notCheckedEngine';
import type { EngineResult, LanguageEngine } from './languageEngine';
import { byPosition, type CheckOptions, type SessionDeps } from './sessionTypes';
import { dominantScript, majorityScript, otherScriptParagraphIds } from './uncheckedScripts';
import type { TierContext } from './tiers';
import type { Paragraph } from './types';

/** The Unicode script English is written in: the proofread script of every document no other engine proofreads. */
const ENGLISH_SCRIPT = 'Latin';

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
  }
> {
  const english = createEnglishEngine(deps.linter);
  const { proofreader, proofreaderScript, paragraphEngines } = routeParagraphs(allParas, english, deps.scriptEngines ?? new Map());
  const parasOf = (engine: LanguageEngine) => allParas.filter((p) => paragraphEngines.get(p.id) === engine);
  // English always runs, even with no paragraph of its own: the session's variant and tier context come from it.
  const fromEnglish = await english.check(parasOf(english), opts, deps.pause);
  const others = [...new Set(paragraphEngines.values())].filter((engine) => engine !== english);
  const fromOthers: EngineResult[] = [];
  for (const engine of others) fromOthers.push(await engine.check(parasOf(engine), opts, deps.pause));

  // A stable sort: English's candidates are already in this order, so alone they stay exactly as they were.
  const found = [...fromEnglish.found, ...fromOthers.flatMap((r) => r.found)].sort(byPosition);
  // Every engine's unchecked paragraphs, in document order.
  const unchecked = new Set([fromEnglish, ...fromOthers].flatMap((r) => r.uncheckedParagraphs));
  const uncheckedParagraphs = allParas.filter((p) => unchecked.has(p.id)).map((p) => p.id);
  const notEnglish = allParas.filter((p) => paragraphEngines.get(p.id) !== english);
  const ctx = withOtherEnginesLocked(fromEnglish.ctx, parasOf(english), notEnglish, opts);
  return { ...fromEnglish, ctx, paragraphEngines, engines: [english, ...others], proofreader, proofreaderScript, found, uncheckedParagraphs };
}

/**
 * #1 gate 1: the paragraphs another engine checks get the same locked text as English ones (URLs, numbers, quotes,
 * commands, adapter locks), and tierOf caps their candidates at 'review' (englishParagraphs). Command text is protected
 * the same way: tierOf hides every non-spelling flag on a surely-command and keeps maybe-commands from zero-click.
 */
function withOtherEnginesLocked(ctx: TierContext, englishParas: Paragraph[], otherParas: Paragraph[], opts: CheckOptions): TierContext {
  const locked = new Map(ctx.locked);
  const { locked: otherLocked, commands } = findLockedText(otherParas, opts.language);
  for (const [id, spans] of otherLocked) locked.set(id, spans);
  const commandSpans = new Map(ctx.commandSpans);
  for (const [id, spans] of commands.surely) commandSpans.set(id, spans);
  const maybeCommandSpans = new Map(ctx.maybeCommandSpans);
  for (const [id, spans] of commands.maybe) maybeCommandSpans.set(id, spans);
  return { ...ctx, locked, commandSpans, maybeCommandSpans, englishParagraphs: new Set(englishParas.map((p) => p.id)) };
}
