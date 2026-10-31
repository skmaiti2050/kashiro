import { withWordAdded } from '@/engine/dictionaryWords';
import type * as desktop from '../platform/settings';
import { defaultSettings, withSavedSettings, type Settings } from '../state/settings';
import { storage, storageIsPersistent as isPersistent } from './storage';

export const storageIsPersistent: typeof desktop.storageIsPersistent = isPersistent;

const KEY = 'settings';

/**
 * The dictionary this tab last loaded or saved. A stored word outside it was added by another tab and is kept when
 * this tab saves; a word in it that this tab's dictionary no longer has was removed here, and stays removed.
 */
let knownDictionary: readonly string[] = [];

/** The saved settings over the defaults (the fallback variant comes from the browser's language). */
export const loadSettings: typeof desktop.loadSettings = async () => {
  const saved = await (await storage()).get<Partial<Settings>>('settings', KEY);
  const settings = withSavedSettings(defaultSettings(navigator.language), saved);
  knownDictionary = settings.dictionary;
  return settings;
};

/**
 * Saves `settings`; the last write wins, except that words another Kashiro tab added since this one loaded are
 * merged into the dictionary, so a stale tab can't lose them (web plan, Review focus 2).
 */
export const saveSettings: typeof desktop.saveSettings = async (settings) => {
  const known = knownDictionary;
  knownDictionary = settings.dictionary;
  await (await storage()).update<Settings>('settings', KEY, (stored) => {
    const fromOtherTabs = (stored?.dictionary ?? []).filter((word) => !known.includes(word));
    return { ...settings, dictionary: fromOtherTabs.reduce(withWordAdded, settings.dictionary) };
  });
};
