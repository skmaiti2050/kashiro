import type { LanguageEngine } from './languageEngine';

/** The one place a language engine is registered, by Unicode script name; #1 adds 'Devanagari' here. */
export function createScriptEngines(): Map<string, LanguageEngine> {
  return new Map();
}
