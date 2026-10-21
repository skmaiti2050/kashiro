import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { Dictionary } from '@/engine/dictionary/lookup';
import type { Rewriter } from '@/engine/llm/suggest';
import { OptionalModules } from '@/ui/state/optionalModules';
import { unloadRomanisedModel } from '@/engine/romanised/classifier';

vi.mock('@/engine/romanised/classifier', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/engine/romanised/classifier')>();
  return { ...real, unloadRomanisedModel: vi.fn(real.unloadRomanisedModel) };
});

const fakeDictionary: Dictionary = {
  lookup: (word) => ({ word, lemma: word, senses: [], inPersonalDictionary: false, inIndianEnglishList: false }),
};
const fakeHelper: Rewriter = { rewrite: async () => null };

function loaders() {
  return {
    loadDictionary: vi.fn(async () => fakeDictionary),
    startHelper: vi.fn(async () => fakeHelper),
  };
}

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
    const on = { ...DEFAULT_MODULES, aiRewrites: true };
    expect(await modules.helper(on)).toBe(fakeHelper);
    await modules.helper(on);
    expect(l.startHelper).toHaveBeenCalledTimes(1);
  });

  it('switching a module off drops what it loaded; switching it on again loads it again', async () => {
    const l = loaders();
    const modules = new OptionalModules(l);
    const on = { ...DEFAULT_MODULES, aiRewrites: true };
    await modules.dictionary(on);
    await modules.helper(on);
    modules.release({ ...on, wordLookup: false, aiRewrites: false });
    expect(modules.dictionary({ ...on, wordLookup: false })).toBeNull();
    await modules.dictionary(on);
    await modules.helper(on);
    expect(l.loadDictionary).toHaveBeenCalledTimes(2);
    expect(l.startHelper).toHaveBeenCalledTimes(2);
  });

  it('the other-languages card off drops the romanised model; on keeps it', () => {
    const modules = new OptionalModules({});
    modules.release(DEFAULT_MODULES);
    expect(unloadRomanisedModel).not.toHaveBeenCalled();
    modules.release({ ...DEFAULT_MODULES, otherLanguageCard: false });
    expect(unloadRomanisedModel).toHaveBeenCalledTimes(1);
  });

  it('no loader given (not wired yet on this platform): null, never an error', () => {
    const modules = new OptionalModules({});
    expect(modules.dictionary(DEFAULT_MODULES)).toBeNull();
    expect(modules.helper({ ...DEFAULT_MODULES, aiRewrites: true })).toBeNull();
  });

  it('a failed load is not kept: the next use tries again', async () => {
    const loadDictionary = vi.fn().mockRejectedValueOnce(new Error('missing file')).mockResolvedValue(fakeDictionary);
    const modules = new OptionalModules({ loadDictionary });
    await expect(modules.dictionary(DEFAULT_MODULES)).rejects.toThrow('missing file');
    expect(await modules.dictionary(DEFAULT_MODULES)).toBe(fakeDictionary);
  });
});
