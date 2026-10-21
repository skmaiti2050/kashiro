/**
 * Optional helpers the user can switch off (Settings › Modules). The core protections (Harper's rules,
 * the fact lock, the offensive-suggestion filter, hygiene and code-token handling) have no switch.
 */
export interface ModuleSwitches {
  /** Names and places as one card; off: each is its own per-word decision. */
  namesCard: boolean;
  /** Repeated unknown lowercase words as one card; off: each word is its own per-word decision. */
  termsCard: boolean;
  /** Romanised Indian-language words as one card; off: per-word decisions, and the classifier's model is never loaded. */
  otherLanguageCard: boolean;
  /** Spelling suggestions re-ranked by likelihood, with likely words added; off: the linter's own list and order. */
  betterSuggestions: boolean;
  /** The local writing helper ("Check how it reads"); off: no helper is started. Not used by the rules check. */
  aiRewrites: boolean;
  /** The offline dictionary (Look up); off: the dictionary is never loaded. Not used by the rules check. */
  wordLookup: boolean;
}

export const DEFAULT_MODULES: Readonly<ModuleSwitches> = Object.freeze({
  namesCard: true,
  termsCard: true,
  otherLanguageCard: true,
  betterSuggestions: true,
  // Off until the user downloads the model.
  aiRewrites: false,
  wordLookup: true,
});

const MODULE_NAMES = Object.keys(DEFAULT_MODULES) as (keyof ModuleSwitches)[];

/**
 * The switches in `chosen` over the defaults. Only the known switches are read, so nothing a caller passes
 * (a stale or hand-edited settings file) can turn off a core protection.
 */
export function resolveModules(chosen: Partial<ModuleSwitches> = {}): ModuleSwitches {
  const modules = { ...DEFAULT_MODULES };
  for (const name of MODULE_NAMES) {
    const value = chosen[name];
    if (typeof value === 'boolean') modules[name] = value;
  }
  return modules;
}
