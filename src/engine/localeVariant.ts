import type { Variant } from './types';

/** Region → variant, for English locales; India also covers hi-IN, bn-IN and other Indian locales. */
const VARIANT_BY_REGION: Record<string, Variant> = {
  US: 'American',
  GB: 'British',
  AU: 'Australian',
  CA: 'Canadian',
  IN: 'Indian',
};

/**
 * A locale's English variant ("en-GB" → British, "hi-IN" → Indian); American when the region is unknown.
 * The app and the CLI both pass the Windows regional format, so they fall back to the same variant.
 */
export function variantForLocale(locale: string): Variant {
  const region = locale.split('-')[1]?.toUpperCase();
  return (region && VARIANT_BY_REGION[region]) || 'American';
}
