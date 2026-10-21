import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { Dictionary } from '@/engine/dictionary/lookup';
import type { Rewriter } from '@/engine/llm/suggest';
import { OptionalModules } from '@/ui/state/optionalModules';

const fakeDictionary: Dictionary = {
  lookup: (word) => ({ word, lemma: word, senses: [], inPersonalDictionary: false, inIndianEnglishList: false }),
};
const fakeRewriter: Rewriter = { rewrite: async () => null };

function loaders() {
  const stop = vi.fn();
  return {
    stop,
    loadDictionary: vi.fn(async () => fakeDictionary),
    startHelper: vi.fn(async () => ({ rewriter: fakeRewriter, stop })),
  };
}

const AI_ON = { ...DEFAULT_MODULES, aiRewrites: true };

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

  it('AI rewrites off (the default): no helper is started', () => {
    const l = loaders();
    const modules = new OptionalModules(l);
    expect(modules.helper(DEFAULT_MODULES)).toBeNull();
    expect(l.startHelper).not.toHaveBeenCalled();
  });

  it('AI rewrites on: the helper starts on first use, once', async () => {
    const l = loaders();
    const modules = new OptionalModules(l);
    expect(await modules.helper(AI_ON)).toBe(fakeRewriter);
    await modules.helper(AI_ON);
    expect(l.startHelper).toHaveBeenCalledTimes(1);
  });

  it('switching modules off drops the dictionary and stops the helper; on again loads and starts them again', async () => {
    const l = loaders();
    const modules = new OptionalModules(l);
    await modules.dictionary(AI_ON);
    await modules.helper(AI_ON);
    await modules.release(AI_ON);
    expect(l.stop).not.toHaveBeenCalled();
    await modules.release({ ...AI_ON, wordLookup: false, aiRewrites: false });
    expect(l.stop).toHaveBeenCalledTimes(1);
    expect(modules.dictionary({ ...AI_ON, wordLookup: false })).toBeNull();
    await modules.dictionary(AI_ON);
    await modules.helper(AI_ON);
    expect(l.loadDictionary).toHaveBeenCalledTimes(2);
    expect(l.startHelper).toHaveBeenCalledTimes(2);
    await modules.release(DEFAULT_MODULES);
    expect(l.stop).toHaveBeenCalledTimes(2);
  });

  it('a helper that failed to start has nothing to stop', async () => {
    const startHelper = vi.fn().mockRejectedValue(new Error('no model'));
    const modules = new OptionalModules({ startHelper });
    await expect(modules.helper(AI_ON)).rejects.toThrow('no model');
    await expect(modules.release(DEFAULT_MODULES)).resolves.toBeUndefined();
  });

  it('a helper that fails to stop reports it', async () => {
    const stop = vi.fn().mockRejectedValue(new Error('still running'));
    const modules = new OptionalModules({ startHelper: async () => ({ rewriter: fakeRewriter, stop }) });
    await modules.helper(AI_ON);
    await expect(modules.release(DEFAULT_MODULES)).rejects.toThrow('still running');
  });

  it('no loader given (not wired yet on this platform): null, never an error', () => {
    const modules = new OptionalModules({});
    expect(modules.dictionary(DEFAULT_MODULES)).toBeNull();
    expect(modules.helper(AI_ON)).toBeNull();
  });

  it('a failed load is not kept: the next use tries again', async () => {
    const loadDictionary = vi.fn().mockRejectedValueOnce(new Error('missing file')).mockResolvedValue(fakeDictionary);
    const modules = new OptionalModules({ loadDictionary });
    await expect(modules.dictionary(DEFAULT_MODULES)).rejects.toThrow('missing file');
    expect(await modules.dictionary(DEFAULT_MODULES)).toBe(fakeDictionary);
  });
});
