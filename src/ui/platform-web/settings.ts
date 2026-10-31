import type { Settings } from '../state/settings';

// A stub until the web adapters land (web plan, Task 2+): same exports as src/ui/platform/settings.ts.
export async function loadSettings(): Promise<Settings> {
  throw new Error('not available on the web yet');
}

export async function saveSettings(_settings: Settings): Promise<void> {
  throw new Error('not available on the web yet');
}
