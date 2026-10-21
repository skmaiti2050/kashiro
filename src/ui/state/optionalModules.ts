import type { Dictionary } from '@/engine/dictionary/lookup';
import type { Rewriter } from '@/engine/llm/suggest';
import type { ModuleSwitches } from '@/engine/modules';

/** A started writing helper: its client, and how to stop its process (llama-server) when AI rewrites go off. */
export interface WritingHelper {
  rewriter: Rewriter;
  stop(): void | Promise<void>;
}

/** How the platform loads the modules that live outside the rules check. Unset: not wired on this platform yet. */
export interface ModuleLoaders {
  /** Reads and indexes the offline dictionary (word lookup). */
  loadDictionary?: () => Promise<Dictionary>;
  /** Starts the local writing helper (AI rewrites). */
  startHelper?: () => Promise<WritingHelper>;
}

/**
 * The data and helper modules, each loaded on first use and only while its switch is on. Switching one off
 * drops the dictionary's reference so its memory can be reclaimed, and stops the helper; switching it on
 * again loads or starts it again.
 */
export class OptionalModules {
  private loadedDictionary: Promise<Dictionary> | null = null;
  private startedHelper: Promise<WritingHelper> | null = null;

  constructor(private readonly loaders: ModuleLoaders) {}

  /** The dictionary, or null when word lookup is off (nothing is loaded) or there is no loader. */
  dictionary(modules: ModuleSwitches): Promise<Dictionary> | null {
    const load = this.loaders.loadDictionary;
    if (!modules.wordLookup || !load) return null;
    this.loadedDictionary ??= this.forgetOnFailure(load(), () => (this.loadedDictionary = null));
    return this.loadedDictionary;
  }

  /** The writing helper's client, or null when AI rewrites are off (no helper is started) or there is no starter. */
  helper(modules: ModuleSwitches): Promise<Rewriter> | null {
    const start = this.loaders.startHelper;
    if (!modules.aiRewrites || !start) return null;
    this.startedHelper ??= this.forgetOnFailure(start(), () => (this.startedHelper = null));
    return this.startedHelper.then((h) => h.rewriter);
  }

  /** Drops the dictionary and stops the helper when their switches are off. Rejects when the helper fails to stop. */
  async release(modules: ModuleSwitches): Promise<void> {
    if (!modules.wordLookup) this.loadedDictionary = null;
    if (modules.aiRewrites || !this.startedHelper) return;
    const started = this.startedHelper;
    this.startedHelper = null;
    let helper: WritingHelper;
    try {
      helper = await started;
    } catch {
      return; // it never started, so there is nothing to stop (the caller of helper() saw the error)
    }
    await helper.stop();
  }

  /** A failed load is not kept, so the next use tries again (the error still reaches this caller). */
  private forgetOnFailure<T>(loading: Promise<T>, forget: () => void): Promise<T> {
    loading.catch(forget);
    return loading;
  }
}
