import type { ReviewDepth } from '@/engine/depth';
import { DEFAULT_MODULES, isRecord, resolveModules, type ModuleSwitches } from '@/engine/modules';
import { PRESETS, type PresetId } from '@/engine/presets';
import { DEFAULT_TERM_MIN_REPEATS } from '@/engine/terms';
import type { Tier, Variant } from '@/engine/types';
import type { SaveMode } from '@/formats/types';

/** Everything the app remembers between runs (stored by platform/settings.ts). */
export interface Settings {
  preset: PresetId;
  /** Used when the document gives no clear spelling variant. */
  fallbackVariant: Variant;
  saveMode: SaveMode;
  /** Save over the opened file (after a backup) instead of writing `name.checked.ext`. */
  overwrite: boolean;
  /** The personal dictionary. */
  dictionary: string[];
  /** "Auto-apply these too": kinds moved to the safe tier. */
  tierOverrides: Partial<Record<string, Tier>>;
  /** The local model for the "reads naturally" pass; unused until that pass ships. */
  modelPath: string | null;
  /** Review depth per preset (spec §5); a preset without one uses the engine's default. */
  depthByPreset: Partial<Record<PresetId, ReviewDepth>>;
  /** Uses after which an unknown lowercase word goes on the terms card (2–5). */
  termMinRepeats: number;
  /** Kinds dismissed with "This rule everywhere"; listed under Settings › Ignored rules with Restore. */
  ignoredRules: string[];
  /** Settings › Modules: the optional helpers on or off, for every goal without its own. */
  modules: ModuleSwitches;
  /** Goals with their own module switches ("Use different modules for this goal"). */
  modulesByPreset: Partial<Record<PresetId, ModuleSwitches>>;
}

/** Region → variant, for English locales; India also covers hi-IN, bn-IN and other Indian locales. */
const VARIANT_BY_REGION: Record<string, Variant> = {
  US: 'American',
  GB: 'British',
  AU: 'Australian',
  CA: 'Canadian',
  IN: 'Indian',
};

/** The OS locale's English variant ("en-GB" → British); American when the region is unknown. */
export function variantForLocale(locale: string): Variant {
  const region = locale.split('-')[1]?.toUpperCase();
  return (region && VARIANT_BY_REGION[region]) || 'American';
}

export function defaultSettings(locale: string): Settings {
  return {
    preset: 'business',
    fallbackVariant: variantForLocale(locale),
    saveMode: 'tracked',
    overwrite: false,
    dictionary: [],
    tierOverrides: {},
    modelPath: null,
    depthByPreset: {},
    termMinRepeats: DEFAULT_TERM_MIN_REPEATS,
    ignoredRules: [],
    modules: { ...DEFAULT_MODULES },
    modulesByPreset: {},
  };
}

/**
 * The saved settings over `defaults`. Module switches go through resolveModules, so a file saved before a
 * module existed gets its default, and an unknown key (a hand-edited "factLock": false) is dropped.
 */
export function withSavedSettings(defaults: Settings, saved: Partial<Settings> | undefined): Settings {
  if (!saved) return defaults;
  const modulesByPreset: Settings['modulesByPreset'] = {};
  const savedByPreset: unknown = saved.modulesByPreset;
  for (const [preset, modules] of Object.entries(isRecord(savedByPreset) ? savedByPreset : {})) {
    if (Object.hasOwn(PRESETS, preset)) modulesByPreset[preset as PresetId] = resolveModules(modules as Partial<ModuleSwitches>);
  }
  return { ...defaults, ...saved, modules: resolveModules(saved.modules ?? defaults.modules), modulesByPreset };
}

/**
 * The module switches for `preset` (default: the current goal): its own when it has them, else the shared
 * ones. AI rewrites stay off until a model is downloaded, whatever the switch says.
 */
export function modulesFor(settings: Settings, preset: PresetId = settings.preset): ModuleSwitches {
  const modules = settings.modulesByPreset[preset] ?? settings.modules;
  return { ...modules, aiRewrites: modules.aiRewrites && settings.modelPath !== null };
}
