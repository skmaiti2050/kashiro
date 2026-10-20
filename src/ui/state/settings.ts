import type { ReviewDepth } from '@/engine/depth';
import type { PresetId } from '@/engine/presets';
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
  };
}
