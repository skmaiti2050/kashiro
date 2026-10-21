import type { Dictionary } from '@/engine/dictionary/lookup';
import type { Rewriter } from '@/engine/llm/suggest';
import type { ModuleSwitches } from '@/engine/modules';
import { unloadRomanisedModel } from '@/engine/romanised/classifier';

/** How the platform loads the modules that live outside the rules check. Unset: not wired on this platform yet. */
export interface ModuleLoaders {
  /** Reads and indexes the offline dictionary (word lookup). */
  loadDictionary?: () => Promise<Dictionary>;
  /** Starts the local writing helper (AI rewrites). */
  startHelper?: () => Promise<Rewriter>;
}

/**
 * The data and helper modules, each loaded on first use and only while its switch is on. Switching one off
 * drops the reference, so its memory can be reclaimed; switching it on again loads it again.
 */
export class OptionalModules {
  private loadedDictionary: Promise<Dictionary> | null = null;
  private startedHelper: Promise<Rewriter> | null = null;

  constructor(private readonly loaders: ModuleLoaders) {}

  /** The dictionary, or null when word lookup is off (nothing is loaded) or there is no loader. */
  dictionary(modules: ModuleSwitches): Promise<Dictionary> | null {
    const load = this.loaders.loadDictionary;
    if (!modules.wordLookup || !load) return null;
    this.loadedDictionary ??= this.forgetOnFailure(load(), () => (this.loadedDictionary = null));
    return this.loadedDictionary;
  }

  /** The writing helper, or null when AI rewrites are off (no helper is started) or there is no starter. */
  helper(modules: ModuleSwitches): Promise<Rewriter> | null {
    const start = this.loaders.startHelper;
    if (!modules.aiRewrites || !start) return null;
    this.startedHelper ??= this.forgetOnFailure(start(), () => (this.startedHelper = null));
    return this.startedHelper;
  }

  /**
   * Drops what the switched-off modules hold. Call it once no session checked with the old switches is in use:
   * the romanised model is dropped too, and a session checked with the other-languages card on still needs it.
   */
  release(modules: ModuleSwitches): void {
    if (!modules.wordLookup) this.loadedDictionary = null;
    if (!modules.aiRewrites) this.startedHelper = null;
    if (!modules.otherLanguageCard) unloadRomanisedModel();
  }

  /** A failed load is not kept, so the next use tries again (the error still reaches this caller). */
  private forgetOnFailure<T>(loading: Promise<T>, forget: () => void): Promise<T> {
    loading.catch(forget);
    return loading;
  }
}
