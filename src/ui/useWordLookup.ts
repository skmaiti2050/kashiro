import { useMemo, useSyncExternalStore } from 'react';
import type { SessionController } from './state/sessionController';
import { WordLookup, type LookupState } from './state/wordLookup';

/** The word lookup over the controller's dictionary (null while word lookup is off) and personal words. */
export function useWordLookup(controller: SessionController): { lookup: WordLookup; state: LookupState | null } {
  const lookup = useMemo(
    () => new WordLookup({ dictionary: () => controller.dictionary(), personalWords: () => controller.getState().settings.dictionary }),
    [controller],
  );
  const state = useSyncExternalStore(lookup.subscribe, lookup.getState);
  return { lookup, state };
}
