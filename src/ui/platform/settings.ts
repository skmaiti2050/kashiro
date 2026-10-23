import { invoke } from '@tauri-apps/api/core';
import { load, type Store } from '@tauri-apps/plugin-store';
import { defaultSettings, withSavedSettings, type Settings } from '../state/settings';

const STORE_FILE = 'settings.json';
const KEY = 'settings';

let store: Promise<Store> | null = null;
const getStore = () => (store ??= load(STORE_FILE, { autoSave: false, defaults: {} }));

/**
 * The Windows regional format ("en-IN"), as the CLI's Node reads it. `navigator.language` is the display
 * language (often "en-US" on Indian PCs), so it is only the stand-in when Windows gives no format.
 */
async function osLocale(): Promise<string> {
  try {
    return (await invoke<string | null>('os_locale')) ?? navigator.language;
  } catch (e) {
    // A missing format only changes the fallback variant, which Settings can set: not worth stopping the start.
    console.warn('os_locale failed; using the display language', e);
    return navigator.language;
  }
}

/** The saved settings over the defaults (the fallback variant comes from the Windows region). */
export async function loadSettings(): Promise<Settings> {
  const [saved, locale] = await Promise.all([(async () => (await getStore()).get<Partial<Settings>>(KEY))(), osLocale()]);
  return withSavedSettings(defaultSettings(locale), saved);
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await getStore();
  await s.set(KEY, settings);
  await s.save();
}
