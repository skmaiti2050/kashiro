import type { UiLocale } from './catalogues';

/** Settings › App language: a language, or "system" (follow Windows). */
export type UiLanguageSetting = 'system' | UiLocale;

/** The languages offered in Settings (en-XA is added in development builds). */
export const UI_LANGUAGES: UiLocale[] = ['en', 'hi'];

/** Each language in its own script (an endonym is never translated). */
export const LANGUAGE_NAMES: Record<UiLocale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  'en-XA': 'Pseudo-locale (en-XA)',
};

/** Languages written right to left; none is translated yet, but the layout is ready (logical CSS, dir). */
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

const baseOf = (locale: string) => locale.split('-')[0].toLowerCase();
const regionOf = (locale: string) => locale.split('-')[1]?.toUpperCase();

/** The UI language for the OS languages (navigator.languages): the first one the app has, else English. */
export function systemLanguage(languages: readonly string[]): 'en' | 'hi' {
  for (const locale of languages) {
    const base = baseOf(locale);
    if (base === 'en' || base === 'hi') return base;
  }
  return 'en';
}

/** The UI language: the Settings choice, else the OS's. The pseudo-locale exists only in development builds. */
export function uiLocaleFor(setting: UiLanguageSetting, languages: readonly string[], dev: boolean): UiLocale {
  if (setting === 'system' || (setting === 'en-XA' && !dev)) return systemLanguage(languages);
  return setting;
}

/** A saved language setting, or "system" when it is missing, damaged or a language this version lacks. */
export function resolveUiLanguage(saved: unknown): UiLanguageSetting {
  if (saved === 'en-XA' || UI_LANGUAGES.includes(saved as UiLocale)) return saved as UiLocale;
  return 'system';
}

/**
 * The locale for numbers, plurals and lists. English keeps the OS region, so an Indian PC shows 1,20,000
 * ("en-IN") and a British one 120,000 ("en-GB"); Hindi is India's.
 */
export function formatLocaleFor(language: UiLocale, languages: readonly string[]): string {
  if (language !== 'en') return language === 'en-XA' ? 'en-XA' : `${language}-IN`;
  const region = languages.map(regionOf).find((r) => r !== undefined);
  return region ? `en-${region}` : 'en';
}

export function dirOf(locale: string): 'ltr' | 'rtl' {
  return RTL_LANGUAGES.has(baseOf(locale)) ? 'rtl' : 'ltr';
}
