import en from './en.json';
import hi from './hi.json';
import { pseudoLocalise } from './pseudo';

/** Entries such as "@@locale" and "@@status" describe a catalogue; they are not messages. */
const METADATA = /^@@/;

/** A key of the English source catalogue. */
export type MessageKey = Exclude<keyof typeof en, `@@${string}`>;

export type Catalogue = Record<string, string>;

/** The UI languages: English (the source), Hindi, and the en-XA pseudo-locale for layout testing. */
export type UiLocale = 'en' | 'hi' | 'en-XA';

/** The message keys of a catalogue, without its metadata entries. */
export function catalogueKeys(catalogue: Catalogue): string[] {
  return Object.keys(catalogue).filter((key) => !METADATA.test(key));
}

let pseudo: Catalogue | null = null;

/** en-XA: every English message pseudo-localised, built on first use (development only). */
function pseudoCatalogue(): Catalogue {
  pseudo ??= Object.fromEntries(catalogueKeys(en).map((key) => [key, pseudoLocalise((en as Catalogue)[key])]));
  return pseudo;
}

/**
 * The messages for `locale`, over English: a key a translation lacks shows in English rather than as its
 * key (the key-coverage test keeps that from happening in a release).
 */
export function messagesFor(locale: UiLocale): Catalogue {
  if (locale === 'hi') return { ...en, ...hi };
  if (locale === 'en-XA') return pseudoCatalogue();
  return en;
}
