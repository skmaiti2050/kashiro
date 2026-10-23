import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { Dictionary } from '@/engine/dictionary/lookup';
import type { Rewriter } from '@/engine/llm/suggest';
import { OptionalModules, type WritingHelper } from '@/ui/state/optionalModules';

const fakeDictionary: Dictionary = {
  lookup: (word) => ({ word, lemma: word, senses: [], inPersonalDictionary: false, inIndianEnglishList: false }),
};
const fakeRewriter: Rewriter = { rewrite: async () => null };
const MODEL = 'C:/models/helper.gguf';

function loaders() {
  const stop = vi.fn();
  return {
    stop,
    loadDictionary: vi.fn(async () => fakeDictionary),
    startHelper: vi.fn(async (_model: string): Promise<WritingHelper> => ({ rewriter: fakeRewriter, stop, backend: 'cpu' })),
  };
}

/** A promise with its resolve function, to hold a start or stop open. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const AI_ON = { ...DEFAULT_MODULES, aiRewrites: true };
const AI_OFF = DEFAULT_MODULES;

describe('OptionalModules', () => {
  it('word lookup off: the dictionary is never loaded', () => {
    const l = loaders();
    const modules = new OptionalModules(l);
    expect(modules.dictionary({ ...DEFAULT_MODULES, wordLookup: false })).toBeNull();
    expect(l.loadDictionary).not.toHaveBeenCalled();
  });

  it('word lookup on: the dictionary loads on first use, once', async () => {
    const l = loaders();
    const modules = new OptionalModules(l);
    expect(await modules.dictionary(DEFAULT_MODULES)).toBe(fakeDictionary);
    await modules.dictionary(DEFAULT_MODULES);
    expect(l.loadDictionary).toHaveBeenCalledTimes(1);
  });

  it('AI rewrites off (the default), or no model chosen: no helper is started', () => {
    const l = loaders();
    const modules = new OptionalModules(l);
    expect(modules.helper(AI_OFF, MODEL)).toBeNull();
    expect(modules.helper(AI_ON, null)).toBeNull();
    expect(l.startHelper).not.toHaveBeenCalled();
  });

  it('AI rewrites on: the helper starts with the chosen model on first use, once', async () => {
    const l = loaders();
    const modules = new OptionalModules(l);
    const started = await modules.helper(AI_ON, MODEL);
    expect(started!.rewriter).toBe(fakeRewriter);
    expect(started!.backend).toBe('cpu');
    await modules.helper(AI_ON, MODEL);
    expect(l.startHelper).toHaveBeenCalledTimes(1);
    expect(l.startHelper).toHaveBeenCalledWith(MODEL);
  });

  it('switching modules off drops the dictionary and stops the helper; on again loads and starts them again', async () => {
    const l = loaders();
    const modules = new OptionalModules(l);
    await modules.dictionary(AI_ON);
    await modules.helper(AI_ON, MODEL);
    await modules.release(AI_ON);
    expect(l.stop).not.toHaveBeenCalled();
    await modules.release({ ...AI_ON, wordLookup: false, aiRewrites: false });
    expect(l.stop).toHaveBeenCalledTimes(1);
    expect(modules.dictionary({ ...AI_ON, wordLookup: false })).toBeNull();
    await modules.dictionary(AI_ON);
    await modules.helper(AI_ON, MODEL);
    expect(l.loadDictionary).toHaveBeenCalledTimes(2);
    expect(l.startHelper).toHaveBeenCalledTimes(2);
    await modules.release(AI_OFF);
    expect(l.stop).toHaveBeenCalledTimes(2);
  });

  it('on again while the first helper is still starting: the second starts only after the first has stopped (U2)', async () => {
    const events: string[] = [];
    const firstStart = deferred<WritingHelper>();
    const firstStop = deferred();
    const startHelper = vi
      .fn<(model: string) => Promise<WritingHelper>>()
      .mockImplementationOnce(() => {
        events.push('start 1');
        return firstStart.promise;
      })
      .mockImplementationOnce(async () => {
        events.push('start 2');
        return { rewriter: fakeRewriter, stop: () => {}, backend: 'cpu' };
      });
    const modules = new OptionalModules({ startHelper });

    const first = modules.helper(AI_ON, MODEL)!;
    const released = modules.release(AI_OFF); // off while the first is still starting
    const second = modules.helper(AI_ON, MODEL)!; // on again before that stop is done
    firstStart.resolve({
      rewriter: fakeRewriter,
      backend: 'vulkan',
      stop: () => {
        events.push('stop 1');
        return firstStop.promise.then(() => void events.push('stopped 1'));
      },
    });
    await first;
    await Promise.resolve();
    expect(events).toEqual(['start 1', 'stop 1']);
    firstStop.resolve();
    await released;
    expect((await second).rewriter).toBe(fakeRewriter);
    expect(events).toEqual(['start 1', 'stop 1', 'stopped 1', 'start 2']);
  });

  it('off while the model still loads: the shell is told to stop at once, without waiting for the load (M5)', async () => {
    const events: string[] = [];
    const load = deferred<WritingHelper>();
    const startHelper = vi.fn(() => {
      events.push('start');
      return load.promise;
    });
    const stopLoading = vi.fn(async () => void events.push('stop now'));
    const modules = new OptionalModules({ startHelper, stopHelper: stopLoading });
    const started = modules.helper(AI_ON, MODEL)!;
    await vi.waitFor(() => expect(events).toEqual(['start']));
    const released = modules.release(AI_OFF);
    await Promise.resolve();
    expect(events).toEqual(['start', 'stop now']);
    // The shell cancels the load (llm.rs's stop counter): the start fails, and there is nothing more to stop.
    load.reject(new Error('The writing helper was stopped while it was loading the model.'));
    await expect(started).rejects.toThrow('stopped while it was loading');
    await released;
    expect(stopLoading).toHaveBeenCalledTimes(1);
  });

  it('a stop that reached the shell before its start: the helper that comes up anyway is stopped too', async () => {
    const l = loaders();
    const load = deferred<WritingHelper>();
    const stopLoading = vi.fn(async () => {});
    const modules = new OptionalModules({ startHelper: () => load.promise, stopHelper: stopLoading });
    const started = modules.helper(AI_ON, MODEL)!;
    const released = modules.release(AI_OFF);
    load.resolve({ rewriter: fakeRewriter, stop: l.stop, backend: 'cpu' });
    await started;
    await released;
    expect(stopLoading).toHaveBeenCalledTimes(1);
    expect(l.stop).toHaveBeenCalledTimes(1);
  });

  it('a helper that finished starting is stopped through itself, not the shell (once)', async () => {
    const l = loaders();
    const stopLoading = vi.fn(async () => {});
    const modules = new OptionalModules({ ...l, stopHelper: stopLoading });
    await modules.helper(AI_ON, MODEL);
    await modules.release(AI_OFF);
    expect(l.stop).toHaveBeenCalledTimes(1);
    expect(stopLoading).not.toHaveBeenCalled();
  });

  it('after a release, the next helper starts with the model file it is given', async () => {
    const events: string[] = [];
    const startHelper = vi.fn(async (model: string) => {
      events.push(`start ${model}`);
      return { rewriter: fakeRewriter, stop: async () => void events.push(`stop ${model}`), backend: 'cpu' as const };
    });
    const modules = new OptionalModules({ startHelper });
    await modules.helper(AI_ON, 'a.gguf');
    await modules.release(AI_OFF);
    await modules.helper(AI_ON, 'b.gguf');
    expect(events).toEqual(['start a.gguf', 'stop a.gguf', 'start b.gguf']);
  });

  it('a helper that failed to start has nothing to stop', async () => {
    const startHelper = vi.fn().mockRejectedValue(new Error('no model'));
    const modules = new OptionalModules({ startHelper });
    await expect(modules.helper(AI_ON, MODEL)).rejects.toThrow('no model');
    await expect(modules.release(AI_OFF)).resolves.toBeUndefined();
  });

  it('a helper that fails to stop reports it, and the next start still goes ahead', async () => {
    const stop = vi.fn().mockRejectedValue(new Error('still running'));
    const startHelper = vi.fn(async () => ({ rewriter: fakeRewriter, stop, backend: 'cpu' as const }));
    const modules = new OptionalModules({ startHelper });
    await modules.helper(AI_ON, MODEL);
    await expect(modules.release(AI_OFF)).rejects.toThrow('still running');
    expect((await modules.helper(AI_ON, MODEL))!.rewriter).toBe(fakeRewriter);
    expect(startHelper).toHaveBeenCalledTimes(2);
  });

  it('no loader given (not wired yet on this platform): null, never an error', () => {
    const modules = new OptionalModules({});
    expect(modules.dictionary(DEFAULT_MODULES)).toBeNull();
    expect(modules.helper(AI_ON, MODEL)).toBeNull();
  });

  it('a failed load is not kept: the next use tries again', async () => {
    const loadDictionary = vi.fn().mockRejectedValueOnce(new Error('missing file')).mockResolvedValue(fakeDictionary);
    const modules = new OptionalModules({ loadDictionary });
    await expect(modules.dictionary(DEFAULT_MODULES)).rejects.toThrow('missing file');
    expect(await modules.dictionary(DEFAULT_MODULES)).toBe(fakeDictionary);
  });
});
