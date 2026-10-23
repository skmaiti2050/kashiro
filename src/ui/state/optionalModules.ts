import type { Dictionary } from '@/engine/dictionary/lookup';
import type { Rewriter } from '@/engine/llm/suggest';
import type { ModuleSwitches } from '@/engine/modules';

/** Which llama-server build runs the helper: the GPU (Vulkan) one or the CPU one. */
export type HelperBackend = 'vulkan' | 'cpu';

/** A started writing helper: its client, its build, and how to stop its process (llama-server) when AI rewrites go off. */
export interface WritingHelper {
  rewriter: Rewriter;
  backend: HelperBackend;
  /** The CPU build runs because the GPU build was tried and did not start (the speed advice says so). */
  gpuFallback?: boolean;
  stop(): void | Promise<void>;
}

/** How the platform loads the modules that live outside the rules check. Unset: not wired on this platform yet. */
export interface ModuleLoaders {
  /** Reads and indexes the offline dictionary (word lookup). */
  loadDictionary?: () => Promise<Dictionary>;
  /** Starts the local writing helper (AI rewrites) with the model file the user chose. */
  startHelper?: (modelPath: string) => Promise<WritingHelper>;
  /** Stops the helper the shell is still starting (its start then fails), without waiting for the model to load. */
  stopHelper?: () => Promise<void>;
}

/**
 * The data and helper modules, each loaded on first use and only while its switch is on. Switching one off
 * drops the dictionary's reference so its memory can be reclaimed, and stops the helper; switching it on
 * again loads or starts it again. At most one helper runs: a start waits until a pending stop has finished.
 */
export class OptionalModules {
  private loadedDictionary: Promise<Dictionary> | null = null;
  private startedHelper: Promise<WritingHelper> | null = null;
  /** The started helper is still starting (loading its model). */
  private helperLoading = false;
  /** The last stop asked for, until it settles; a start waits for it (two servers would clash on 4 GB). */
  private stopping: Promise<void> | null = null;

  constructor(private readonly loaders: ModuleLoaders) {}

  /** The dictionary, or null when word lookup is off (nothing is loaded) or there is no loader. */
  dictionary(modules: ModuleSwitches): Promise<Dictionary> | null {
    const load = this.loaders.loadDictionary;
    if (!modules.wordLookup || !load) return null;
    this.loadedDictionary ??= this.forgetOnFailure(load(), () => (this.loadedDictionary = null));
    return this.loadedDictionary;
  }

  /**
   * The started writing helper, or null when AI rewrites are off, no model is chosen or there is no starter.
   * When the user picks another model, the caller releases the helper first (see SessionController).
   */
  helper(modules: ModuleSwitches, modelPath: string | null): Promise<WritingHelper> | null {
    const start = this.loaders.startHelper;
    if (!modules.aiRewrites || !start || modelPath === null) return null;
    if (!this.startedHelper) {
      // A failed stop was reported by release(); it must not block the next start (the shell replaces a server it still has).
      const afterStop = (this.stopping ?? Promise.resolve()).catch(() => {});
      const started = afterStop.then(() => start(modelPath));
      this.startedHelper = started;
      this.helperLoading = true;
      const loaded = () => {
        if (this.startedHelper === started) this.helperLoading = false;
      };
      started.then(loaded, loaded);
      this.forgetOnFailure(started, () => {
        if (this.startedHelper === started) this.startedHelper = null;
      });
    }
    return this.startedHelper;
  }

  /** Drops the dictionary and stops the helper when their switches are off. Rejects when the helper fails to stop. */
  async release(modules: ModuleSwitches): Promise<void> {
    if (!modules.wordLookup) this.loadedDictionary = null;
    if (modules.aiRewrites) return;
    await this.stopHelper();
  }

  /** Stops the started helper (after it finished starting), and records the stop so the next start waits. */
  private stopHelper(): Promise<void> {
    const started = this.startedHelper;
    if (!started) return this.stopping ?? Promise.resolve();
    this.startedHelper = null;
    // Still loading: the shell stops it now (llm.rs counts the stop and cancels the start) rather than after the load.
    const now = this.helperLoading && this.loaders.stopHelper ? this.loaders.stopHelper() : null;
    this.helperLoading = false;
    const afterLoad = started.then(
      // Came up anyway (the stop reached the shell before its start did): stop it now.
      (helper) => helper.stop(),
      () => {}, // it never started, so there is nothing to stop (the caller of helper() saw the error)
    );
    const stopping = Promise.all([now, afterLoad]).then(() => {});
    this.stopping = stopping;
    const settled = () => {
      if (this.stopping === stopping) this.stopping = null;
    };
    stopping.then(settled, settled);
    return stopping;
  }

  /** A failed load is not kept, so the next use tries again (the error still reaches this caller). */
  private forgetOnFailure<T>(loading: Promise<T>, forget: () => void): Promise<T> {
    loading.catch(forget);
    return loading;
  }
}
