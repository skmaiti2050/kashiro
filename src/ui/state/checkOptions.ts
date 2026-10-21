import { DEFAULT_DEPTH, type ReviewDepth } from '@/engine/depth';
import type { CheckOptions } from '@/engine/session';
import type { Variant } from '@/engine/types';
import type { Settings } from './settings';

/** The review depth saved for the current preset, or the engine's default. */
export function currentDepth(settings: Settings): ReviewDepth {
  return settings.depthByPreset[settings.preset] ?? DEFAULT_DEPTH;
}

/** The engine's options for a check of the open document under these settings. */
export function checkOptions(
  settings: Settings,
  variantOverride: Variant | null,
  documentIgnoredRules: string[],
  language: 'plaintext' | 'markdown',
): CheckOptions {
  return {
    ignoredRules: [...settings.ignoredRules, ...documentIgnoredRules],
    preset: settings.preset,
    variant: variantOverride ?? undefined,
    fallbackVariant: settings.fallbackVariant,
    language,
    dictionary: settings.dictionary,
    tierOverrides: settings.tierOverrides,
    depth: currentDepth(settings),
    termMinRepeats: settings.termMinRepeats,
  };
}
