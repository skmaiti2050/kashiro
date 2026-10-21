import { load, type Store } from '@tauri-apps/plugin-store';
import { defaultSettings, withSavedSettings, type Settings } from '../state/settings';

const STORE_FILE = 'settings.json';
const KEY = 'settings';

let store: Promise<Store> | null = null;
const getStore = () => (store ??= load(STORE_FILE, { autoSave: false, defaults: {} }));

/** The saved settings over the defaults (the fallback variant comes from the OS language). */
export async function loadSettings(): Promise<Settings> {
  const saved = await (await getStore()).get<Partial<Settings>>(KEY);
  return withSavedSettings(defaultSettings(navigator.language), saved);
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await getStore();
  await s.set(KEY, settings);
  await s.save();
}
