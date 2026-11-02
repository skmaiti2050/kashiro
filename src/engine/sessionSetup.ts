import { createEnglishEngine, type EnglishResult } from './englishEngine';
import { notCheckedEngine } from './notCheckedEngine';
import type { EngineResult, LanguageEngine } from './languageEngine';
import { byPosition, type CheckOptions, type SessionDeps } from './sessionTypes';
import { dominantScript, otherScriptParagraphIds } from './uncheckedScripts';
import type { Paragraph } from './types';

/** The engine registered for the script `text` is mostly written in, else the not-checked engine. */
function engineForScript(text: string, scriptEngines: ReadonlyMap<string, LanguageEngine>): LanguageEngine {
  if (scriptEngines.size === 0) return notCheckedEngine;
  const script = dominantScript(text, scriptEngines.keys());
  return (script && scriptEngines.get(script)) || notCheckedEngine;
}

/**
 * The engine for each paragraph: English for one mostly in Latin letters; for one mostly in another script (#2a),
 * the engine registered for its script, else the not-checked engine.
 */
function routeParagraphs(
  paras: Paragraph[],
  english: LanguageEngine,
  scriptEngines: ReadonlyMap<string, LanguageEngine>,
): Map<number, LanguageEngine> {
  // A paragraph no engine proofreads gets no candidate of any kind (never damage).
  const setAside = new Set(otherScriptParagraphIds(paras));
  return new Map(paras.map((p) => [p.id, setAside.has(p.id) ? engineForScript(p.text, scriptEngines) : english]));
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
  }
> {
  const english = createEnglishEngine(deps.linter);
  const paragraphEngines = routeParagraphs(allParas, english, deps.scriptEngines ?? new Map());
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
  return { ...fromEnglish, paragraphEngines, engines: [english, ...others], found, uncheckedParagraphs };
}
