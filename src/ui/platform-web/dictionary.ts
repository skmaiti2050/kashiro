import type { Dictionary } from '@/engine/dictionary/lookup';

// A stub until the web adapters land (web plan, Task 2+): same exports as src/ui/platform/dictionary.ts.
export async function loadAppDictionary(): Promise<Dictionary> {
  throw new Error('not available on the web yet');
}
