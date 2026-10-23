import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, MODELS, knownModel } from '@/engine/llm/models';
import { ASSETS } from '../../../scripts/deps/assets';

const QWEN_SHA = 'ff5c3e9740a5aa53f04fdf3b0b8cc75da556bf8948cdb19d61c512d3a43465d9';

describe('models', () => {
  it('the default is Qwen3.5-4B IQ4_NL, Apache-2.0, with the hash and size measured locally', () => {
    expect(DEFAULT_MODEL).toEqual({
      id: 'qwen3.5-4b-iq4_nl',
      label: 'Qwen3.5-4B (IQ4_NL)',
      fileName: 'Qwen3.5-4B-IQ4_NL.gguf',
      sha256: QWEN_SHA,
      sizeBytes: 2_579_944_608,
      licence: 'Apache-2.0',
    });
    expect(MODELS).toEqual([DEFAULT_MODEL]);
  });

  it('matches the model pinned in deps/assets.json', () => {
    const pinned = ASSETS.find((a) => a.id === 'local-llm')!;
    expect(pinned.sha256).toBe(DEFAULT_MODEL.sha256);
    expect(pinned.licence).toBe(DEFAULT_MODEL.licence);
  });

  it('names a known model by its hash, in either case, and nothing else', () => {
    expect(knownModel(QWEN_SHA)).toBe(DEFAULT_MODEL);
    expect(knownModel(QWEN_SHA.toUpperCase())).toBe(DEFAULT_MODEL);
    expect(knownModel('0'.repeat(64))).toBeNull();
  });
});
