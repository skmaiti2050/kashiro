import { createContext, useContext, type ReactNode } from 'react';
import { createTranslator, type Translator } from './translator';

/** English until the app provides the chosen language (components rendered alone, in tests, read English). */
const TranslatorContext = createContext<Translator>(createTranslator('en', ['en-US']));

export function TranslatorProvider({ translator, children }: { translator: Translator; children: ReactNode }) {
  return <TranslatorContext.Provider value={translator}>{children}</TranslatorContext.Provider>;
}

/** The active language's text, numbers and lists. */
export function useT(): Translator {
  return useContext(TranslatorContext);
}
