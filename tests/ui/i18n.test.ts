// Interface translation (Task L1): catalogues, plurals, Indian number formats, locale choice, pseudo-locale.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import en from '@/ui/i18n/en.json';
import hi from '@/ui/i18n/hi.json';
import bn from '@/ui/i18n/bn.json';
import { catalogueKeys, type MessageKey } from '@/ui/i18n/catalogues';
import { dirOf, formatLocaleFor, resolveUiLanguage, systemLanguage, uiLocaleFor } from '@/ui/i18n/locale';
import { msg } from '@/ui/i18n/message';
import { pseudoLocalise } from '@/ui/i18n/pseudo';
import { createTranslator } from '@/ui/i18n/translator';

const KEYS = catalogueKeys(en);
const TRANSLATIONS = [hi, bn] as Record<string, string>[];
const METADATA = /^@@/;

/** Every source file under src/ui, as one string (keys must appear there as literals). */
function uiSource(dir = 'src/ui'): string {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .map((path) => (statSync(path).isDirectory() ? uiSource(path) : /\.tsx?$/.test(path) ? readFileSync(path, 'utf8') : ''))
    .join('\n');
}

describe('catalogues', () => {
  it('every key exists in every catalogue, and no catalogue has a key English lacks', () => {
    for (const catalogue of TRANSLATIONS) {
      expect(catalogueKeys(catalogue).sort()).toEqual([...KEYS].sort());
    }
  });

  it('Hindi and Bengali are marked as needing native review', () => {
    expect((hi as Record<string, string>)['@@status']).toBe('needs native review');
    expect((bn as Record<string, string>)['@@status']).toBe('needs native review');
  });

  it('no unused keys: every key is used in the UI code as a literal', () => {
    const source = uiSource();
    const unused = KEYS.filter((key) => !source.includes(`'${key}'`));
    expect(unused).toEqual([]);
  });

  it('every message parses and formats in every language, keeping its placeholders', () => {
    for (const language of ['en', 'hi', 'bn', 'en-XA'] as const) {
      const t = createTranslator(language, ['en-IN']);
      for (const key of KEYS) {
        const text = t.rich(key as MessageKey, sampleValuesFor(en[key as keyof typeof en]));
        expect(text, `${language} ${key}`).toBeTruthy();
      }
    }
  });

  it('translations keep the same placeholders as English', () => {
    // Argument names only ("{count," or "{name}"), not the words of a select branch ("{new copy}").
    const placeholders = (message: string) => [...message.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]).sort();
    for (const catalogue of TRANSLATIONS) {
      for (const key of KEYS) expect(placeholders(catalogue[key]), key).toEqual(placeholders((en as Record<string, string>)[key]));
    }
  });

  it('metadata entries are not keys', () => {
    expect(KEYS.some((key) => METADATA.test(key))).toBe(false);
  });
});

/** A value for each placeholder of `message` (a number for plural/number arguments, a tag function for <b>). */
function sampleValuesFor(message: string): Record<string, string | number | ((chunks: unknown[]) => string)> {
  const values: Record<string, string | number | ((chunks: unknown[]) => string)> = {};
  for (const [, name, type] of message.matchAll(/\{(\w+)(?:,\s*(\w+))?/g)) values[name] = type === 'plural' || type === 'number' ? 2 : 'x';
  for (const [, tag] of message.matchAll(/<(\w+)>/g)) values[tag] = (chunks) => chunks.join('');
  values.mode = 'tracked';
  values.overwrite = 'yes';
  return values;
}

describe('plurals', () => {
  const count = (language: 'en' | 'hi' | 'bn', n: number) => createTranslator(language, ['en-IN']).t('status.words', { count: n });

  it('English: one word, 2 words, 0 words', () => {
    expect(count('en', 1)).toBe('1 word');
    expect(count('en', 2)).toBe('2 words');
    expect(count('en', 0)).toBe('0 words');
  });

  const places = (language: 'en' | 'hi' | 'bn', n: number) => createTranslator(language, ['en-IN']).t('card.places', { count: n });

  it('English: "place" for 1 only', () => {
    expect([0, 1, 2].map((n) => places('en', n))).toEqual(['(0 places)', '(1 place)', '(2 places)']);
  });

  it('Hindi: CLDR "one" covers 0 and 1 (जगह), "other" is the plural (जगहें)', () => {
    expect([0, 1, 2].map((n) => places('hi', n))).toEqual(['(0 जगह)', '(1 जगह)', '(2 जगहें)']);
  });

  it('Bengali: one form with the "টি" counter, in Latin digits (owner decision)', () => {
    expect([0, 1, 2].map((n) => places('bn', n))).toEqual(['(0টি জায়গা)', '(1টি জায়গা)', '(2টি জায়গা)']);
    expect(count('bn', 0)).toBe('0টি শব্দ');
    expect(count('bn', 120000)).toBe('1,20,000টি শব্দ');
  });

  it('Bengali: an exact =0 branch wins over the plural category', () => {
    const t = createTranslator('bn', ['bn-IN']);
    expect(t.t('panel.autoFixed', { count: 0 })).toBe('নিজে থেকে কোনো সংশোধন হয়নি।');
    expect(t.t('panel.autoFixed', { count: 3 })).toBe('3টি সংশোধন নিজে থেকে হয়েছে।');
  });

  it('Hindi: no decision made reads as words, not "0 फ़ैसला"', () => {
    const t = createTranslator('hi', ['hi-IN']);
    expect(t.t('progress.done', { count: 0 })).not.toMatch(/0/);
    expect(t.t('progress.done', { count: 1 })).toBe('हो गया: 1 फ़ैसला किया गया');
    expect(t.t('progress.done', { count: 3 })).toBe('हो गया: 3 फ़ैसले किए गए');
  });

  it('nested plural inside a sentence (progress done line)', () => {
    const t = createTranslator('en', ['en-US']);
    expect(t.t('progress.done', { count: 1 })).toBe('Done: 1 decision made');
    expect(t.t('progress.done', { count: 3 })).toBe('Done: 3 decisions made');
  });
});

describe('numbers', () => {
  it('en-IN groups in lakhs: 1,20,000', () => {
    const t = createTranslator('en', ['en-IN']);
    expect(t.formatLocale).toBe('en-IN');
    expect(t.number(120000)).toBe('1,20,000');
    expect(t.t('status.words', { count: 120000 })).toBe('1,20,000 words');
  });

  it('en-US groups in thousands', () => {
    expect(createTranslator('en', ['en-US']).number(120000)).toBe('120,000');
  });

  it('Hindi uses Indian grouping too', () => {
    expect(createTranslator('hi', ['hi-IN']).number(120000)).toBe('1,20,000');
  });

  it('Bengali uses Indian grouping in Latin digits: 1,20,000 (owner decision, not CLDR’s ১,২০,০০০)', () => {
    expect(createTranslator('bn', ['en-US']).number(120000)).toBe('1,20,000');
  });

  it('no catalogue writes digits of its own script: numbers are arguments', () => {
    for (const catalogue of TRANSLATIONS) {
      const withDigits = catalogueKeys(catalogue).filter((key) => /[০-৯०-९]/.test(catalogue[key]));
      expect(withDigits).toEqual([]);
    }
  });

  it('module costs are formatted numbers in every language', () => {
    const cost = (language: 'en' | 'hi' | 'bn') => createTranslator(language, ['en-IN']).t('modules.wordLookupCost', { memory: 60, data: 3.5 });
    expect(cost('en')).toBe('About 60 MB of memory once you look up a word (3.5 MB of data).');
    expect(cost('bn')).toContain('60 MB');
    expect(cost('bn')).toContain('3.5 MB');
    expect(createTranslator('en', ['en-IN']).t('modules.aiRewritesCost', { min: 1, max: 3 })).toBe('A 1–3 GB model, and as much memory while it runs.');
    expect(createTranslator('bn', ['bn-IN']).t('modules.aiRewritesCost', { min: 1, max: 3 })).toMatch(/^1–3 GB/);
  });

  it('lists use the language’s own "or"', () => {
    expect(createTranslator('en', ['en-IN']).list(['“its”', '“it is”'], 'disjunction')).toBe('“its” or “it is”');
    expect(createTranslator('hi', ['hi-IN']).list(['a', 'b'], 'disjunction')).toBe('a या b');
    expect(createTranslator('bn', ['bn-IN']).list(['a', 'b'], 'disjunction')).toBe('a বা b');
  });
});

describe('nested messages', () => {
  it('formats a message whose values are messages', () => {
    const t = createTranslator('en', ['en-IN']);
    const error = msg('error.explain', { what: msg('error.open', { name: 'a.docx' }), cause: 'Not a Word document.', next: msg('error.openNext') });
    expect(t.format(error)).toBe('Can’t open a.docx: Not a Word document. Check that the file opens in Word or a text editor, then try again.');
  });
});

describe('locale', () => {
  it('the UI language follows the first OS language the app has', () => {
    expect(systemLanguage(['hi-IN', 'en-IN'])).toBe('hi');
    expect(systemLanguage(['bn-IN', 'en-IN'])).toBe('bn');
    expect(systemLanguage(['bn-BD'])).toBe('bn');
    expect(systemLanguage(['ta-IN', 'en-IN'])).toBe('en');
    expect(systemLanguage(['fr-FR'])).toBe('en');
    expect(systemLanguage([])).toBe('en');
  });

  it('the Settings choice wins over the OS; the pseudo-locale only in development', () => {
    expect(uiLocaleFor('system', ['hi-IN'], false)).toBe('hi');
    expect(uiLocaleFor('hi', ['en-IN'], false)).toBe('hi');
    expect(uiLocaleFor('en', ['hi-IN'], false)).toBe('en');
    expect(uiLocaleFor('en-XA', ['hi-IN'], true)).toBe('en-XA');
    expect(uiLocaleFor('en-XA', ['hi-IN'], false)).toBe('hi');
  });

  it('a damaged or unknown saved language means "same as Windows"', () => {
    expect(resolveUiLanguage('hi')).toBe('hi');
    expect(resolveUiLanguage('bn')).toBe('bn');
    expect(resolveUiLanguage('en-XA')).toBe('en-XA');
    expect(resolveUiLanguage('fr')).toBe('system');
    expect(resolveUiLanguage(42)).toBe('system');
    expect(resolveUiLanguage(undefined)).toBe('system');
  });

  it('English keeps the OS region for numbers; Hindi and Bengali use India’s', () => {
    expect(formatLocaleFor('bn', ['en-US'])).toBe('bn-IN-u-nu-latn');
    expect(formatLocaleFor('en', ['en-IN'])).toBe('en-IN');
    expect(formatLocaleFor('en', ['hi-IN'])).toBe('en-IN');
    expect(formatLocaleFor('en', ['en-GB'])).toBe('en-GB');
    expect(formatLocaleFor('en', ['fr'])).toBe('en');
    expect(formatLocaleFor('hi', ['en-US'])).toBe('hi-IN');
  });

  it('text direction comes from the language, ready for Urdu', () => {
    expect(dirOf('hi')).toBe('ltr');
    expect(dirOf('bn')).toBe('ltr');
    expect(dirOf('en-XA')).toBe('ltr');
    expect(dirOf('ur')).toBe('rtl');
    expect(dirOf('ar-EG')).toBe('rtl');
  });
});

describe('pseudo-locale (en-XA)', () => {
  it('accents every letter, brackets the text and makes it about 35% longer', () => {
    const pseudo = pseudoLocalise('Save options');
    expect(pseudo.startsWith('[')).toBe(true);
    expect(pseudo.endsWith(']')).toBe(true);
    expect(pseudo).not.toMatch(/[A-Za-z]/);
    expect(pseudo.length).toBeGreaterThanOrEqual(Math.round('Save options'.length * 1.35));
  });

  it('keeps placeholders, plural syntax, # and tags intact', () => {
    const pseudo = pseudoLocalise('{count, plural, one {# word} other {# words}} in <b>{name}</b>');
    const t = createTranslator('en-XA', ['en-IN']);
    expect(pseudo).toContain('{count, plural, one {#');
    expect(pseudo).toContain('<b>{name}</b>');
    expect(t.t('status.words', { count: 2 })).toMatch(/^\[2 [^A-Za-z]+\]$/);
  });
});
