import type { ReviewDepth } from '@/engine/depth';
import { DEFAULT_MODULES, isRecord, resolveModules, type ModuleSwitches } from '@/engine/modules';
import { PRESETS, type PresetId } from '@/engine/presets';
import { DEFAULT_TERM_MIN_REPEATS } from '@/engine/terms';
import type { Tier, Variant } from '@/engine/types';
import { variantForLocale } from '@/engine/localeVariant';
import type { SaveMode } from '@/formats/types';
import { resolveUiLanguage, type UiLanguageSetting } from '../i18n/locale';
import { DEFAULT_READING, resolveReading, type ReadingSettings } from './readingSettings';
import { resolveHelperSpeed, type HelperSpeed } from './helperSpeed';

/** Everything the app remembers between runs (stored by platform/settings.ts). */
export interface Settings {
  preset: PresetId;
  /** Used when the document gives no clear spelling variant. */
  fallbackVariant: Variant;
  /** True once the user picked fallbackVariant in Settings; until then it follows the Windows region on every start. */
  fallbackVariantChosen: boolean;
  saveMode: SaveMode;
  /** Save over the opened file (after a backup) instead of writing `name.checked.ext`. */
  overwrite: boolean;
  /** The personal dictionary. */
  dictionary: string[];
  /** "Auto-apply these too": kinds moved to the safe tier. */
  tierOverrides: Partial<Record<string, Tier>>;
  /** The writing helper's model file (.gguf), chosen in Settings › Modules; AI rewrites stay off without one. */
  modelPath: string | null;
  /** That file's SHA-256 when it was chosen: names a known model (src/engine/llm/models.ts). */
  modelSha256: string | null;
  /** The warm-up benchmark's result, measured once when AI rewrites are first switched on with this model. */
  helperSpeed: HelperSpeed | null;
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
  /** Text size, readable fonts, spacing and the read-aloud voice. */
  reading: ReadingSettings;
  /** Settings › App language; separate from the English variant used for checking. */
  uiLanguage: UiLanguageSetting;
  /** Saved reviews: pasted text is kept for resuming only when this is on. */
  keepPastedText: boolean;
  /** Saved reviews are deleted this many days after their last change; 0 keeps none. */
  sessionRetentionDays: number;
}

export const DEFAULT_RETENTION_DAYS = 30;

/**
 * Kinds the user may move to auto-apply in Settings (spec §5). LLM rewrites and fact-locked spans are never
 * offered (the engine keeps them in review whatever the setting), and neither is Variant: the app never
 * converts between English variants on its own. The never-damage stress test switches all of them on.
 */
export const AUTO_APPLY_KINDS = ['Agreement', 'Grammar', 'Usage', 'WordChoice', 'Redundancy', 'Style', 'Readability', 'Contraction'];

// One mapping for the app and the CLI (Task U3 item 6).
export { variantForLocale };

/** `locale`: the Windows regional format ("en-IN"), as the CLI gets it from Node; see platform/settings.ts. */
export function defaultSettings(locale: string): Settings {
  return {
    preset: 'business',
    fallbackVariant: variantForLocale(locale),
    fallbackVariantChosen: false,
    saveMode: 'tracked',
    overwrite: false,
    dictionary: [],
    tierOverrides: {},
    modelPath: null,
    modelSha256: null,
    helperSpeed: null,
    depthByPreset: {},
    termMinRepeats: DEFAULT_TERM_MIN_REPEATS,
    ignoredRules: [],
    modules: { ...DEFAULT_MODULES },
    modulesByPreset: {},
    reading: { ...DEFAULT_READING },
    uiLanguage: 'system',
    keepPastedText: false,
    sessionRetentionDays: DEFAULT_RETENTION_DAYS,
  };
}

/** A network (UNC) or device path: `\\host\share\…`, `//host/…`, `\\?\…`. Opening one would contact that host. */
const NETWORK_PATH = /^(?:\\\\|\/\/)/;
/** A SHA-256 in hex. */
const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** True for a model path the app may use: not on a network share (llm.rs refuses those too). */
export function isLocalPath(path: string): boolean {
  return !NETWORK_PATH.test(path);
}

/**
 * The saved model file and its hash, or both null: a hand-edited or damaged settings file may hold another
 * type, a hash that is not SHA-256, or a network path.
 */
function resolveModel(path: unknown, sha256: unknown): Pick<Settings, 'modelPath' | 'modelSha256'> {
  if (typeof path !== 'string' || path === '' || !isLocalPath(path)) return { modelPath: null, modelSha256: null };
  return { modelPath: path, modelSha256: typeof sha256 === 'string' && SHA256_HEX.test(sha256) ? sha256.toLowerCase() : null };
}

/** Ten years: a longer retention in a hand-edited file is cut to this. */
const MAX_RETENTION_DAYS = 3650;

/** A hand-edited or damaged retention (negative, a fraction, text) means the default; a huge one, the maximum. */
function resolveRetention(days: unknown): number {
  if (!Number.isInteger(days) || (days as number) < 0) return DEFAULT_RETENTION_DAYS;
  return Math.min(days as number, MAX_RETENTION_DAYS);
}

/**
 * A settings file from before Task U3 has no fallbackVariantChosen, and the app then saved the variant of the
 * display language (`displayLanguage`, navigator.language) unasked. A saved fallback that differs from that one
 * was picked on purpose, so it counts as chosen.
 */
export function markDeliberateFallback(saved: Partial<Settings> | undefined, displayLanguage: string): Partial<Settings> | undefined {
  if (!saved?.fallbackVariant || saved.fallbackVariantChosen !== undefined) return saved;
  return saved.fallbackVariant === variantForLocale(displayLanguage) ? saved : { ...saved, fallbackVariantChosen: true };
}

/**
 * The saved settings over `defaults`. Module switches go through resolveModules, so a file saved before a
 * module existed gets its default, and an unknown key (a hand-edited "factLock": false) is dropped.
 * Reading settings go through resolveReading, which clamps sizes and spacing to their ranges.
 */
export function withSavedSettings(defaults: Settings, saved: Partial<Settings> | undefined): Settings {
  if (!saved) return defaults;
  const modulesByPreset: Settings['modulesByPreset'] = {};
  const savedByPreset: unknown = saved.modulesByPreset;
  for (const [preset, modules] of Object.entries(isRecord(savedByPreset) ? savedByPreset : {})) {
    if (Object.hasOwn(PRESETS, preset)) modulesByPreset[preset as PresetId] = resolveModules(modules as Partial<ModuleSwitches>);
  }
  // Before Task U3 every save stored the fallback variant, chosen or not: only a chosen one outlives the Windows region.
  const chosen = saved.fallbackVariantChosen === true;
  return {
    ...defaults,
    ...saved,
    fallbackVariant: chosen && saved.fallbackVariant ? saved.fallbackVariant : defaults.fallbackVariant,
    fallbackVariantChosen: chosen,
    ...resolveModel(saved.modelPath, saved.modelSha256),
    helperSpeed: resolveHelperSpeed(saved.helperSpeed),
    modules: resolveModules(saved.modules ?? defaults.modules),
    modulesByPreset,
    reading: resolveReading(saved.reading ?? defaults.reading),
    uiLanguage: resolveUiLanguage(saved.uiLanguage ?? defaults.uiLanguage),
    keepPastedText: saved.keepPastedText === true,
    sessionRetentionDays: resolveRetention(saved.sessionRetentionDays ?? defaults.sessionRetentionDays),
  };
}

/**
 * The module switches for `preset` (default: the current goal): its own when it has them, else the shared
 * ones. AI rewrites stay off until a model file is chosen, whatever the switch says.
 */
export function modulesFor(settings: Settings, preset: PresetId = settings.preset): ModuleSwitches {
  const modules = settings.modulesByPreset[preset] ?? settings.modules;
  return { ...modules, aiRewrites: modules.aiRewrites && settings.modelPath !== null };
}
