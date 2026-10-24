import type { ReactNode } from 'react';
import { createIntl, createIntlCache, type IntlShape } from 'react-intl';
import { messagesFor, type MessageKey, type UiLocale } from './catalogues';
import { dirOf, formatLocaleFor } from './locale';
import type { Message, MessageValue } from './message';

type Values = Record<string, string | number>;
/** Rich values: plain ones, or a function for a tag ("<b>…</b>" → b: (chunks) => <strong>{chunks}</strong>). */
type RichValues = Record<string, ReactNode | ((chunks: ReactNode[]) => ReactNode)>;

/** Everything the UI needs to show text in one language. */
export interface Translator {
  /** The UI language ("hi"), also the `lang` of the page. */
  language: UiLocale;
  /** The locale numbers, plurals and lists follow ("hi-IN", or "en-IN" for English on an Indian PC). */
  formatLocale: string;
  dir: 'ltr' | 'rtl';
  t(key: MessageKey, values?: Values): string;
  /** A message with tags (<b>, <em>) as React elements. */
  rich(key: MessageKey, values: RichValues): ReactNode;
  /** A message the controller kept, with any messages among its values formatted first. */
  format(message: Message): string;
  number(n: number): string;
  /** "“its” or “it is”" (disjunction) in the language's own words. */
  list(items: string[], type: 'conjunction' | 'disjunction'): string;
}

const cache = createIntlCache();

/** A format problem in a catalogue (a bad plural, a missing value) is a bug: say so, and show the key's English. */
function reportFormatError(error: { message: string }): void {
  console.error(`Kashiro i18n: ${error.message}`);
}

export function createTranslator(language: UiLocale, osLanguages: readonly string[]): Translator {
  const formatLocale = formatLocaleFor(language, osLanguages);
  const intl: IntlShape = createIntl({ locale: formatLocale, messages: messagesFor(language), onError: reportFormatError }, cache);
  const t = (key: MessageKey, values?: Values) => intl.formatMessage({ id: key }, values);
  const format = (message: Message): string => {
    const values: Values = {};
    for (const [name, value] of Object.entries(message.values ?? {})) values[name] = formatValue(value);
    return t(message.key, values);
  };
  const formatValue = (value: MessageValue): string | number => (typeof value === 'object' ? format(value) : value);

  return {
    language,
    formatLocale,
    dir: dirOf(language),
    t,
    rich: (key, values) => intl.formatMessage({ id: key }, values),
    format,
    number: (n) => intl.formatNumber(n),
    list: (items, type) => intl.formatList(items, { type }),
  };
}
