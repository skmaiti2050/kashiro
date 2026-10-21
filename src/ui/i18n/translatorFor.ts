import { uiLocaleFor, type UiLanguageSetting } from './locale';
import { createTranslator, type Translator } from './translator';

const cache = new Map<string, Translator>();

/** The OS languages (WebView2 reports the Windows display language first). */
const osLanguages = (): readonly string[] => (typeof navigator === 'undefined' ? [] : navigator.languages);

/**
 * The translator for the Settings choice on this PC, made once per language: a new one only when the
 * language changes, so switching re-renders the UI and nothing else does.
 */
export function translatorFor(setting: UiLanguageSetting): Translator {
  const languages = osLanguages();
  const language = uiLocaleFor(setting, languages, import.meta.env.DEV);
  const key = `${language}|${languages.join(',')}`;
  let translator = cache.get(key);
  if (!translator) {
    translator = createTranslator(language, languages);
    cache.set(key, translator);
  }
  return translator;
}
