import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, pinnedSha256 } from '../../scripts/deps/assets';
import { checkLicence } from '../../scripts/deps/licences';
import { PINNED_SHA256 as DICTIONARY_SHA } from '../../scripts/build-dictionary';
import { PINNED_SHA256 as FREQUENCY_SHA } from '../../scripts/build-frequency';
import { PINNED_SHA256 as ROMANISED_SHA } from '../../scripts/build-romanised';

const ROOT = path.resolve(__dirname, '../..');
const sha256File = (file: string) => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const LLAMA_BUILDS = ['llama-server', 'llama-server-vulkan'];

describe('deps/assets.json', () => {
  const pinned = ASSETS.filter((a) => a.status === 'pinned');

  it('lists the data files, the default model and both llama-server builds, without the dropped context model', () => {
    expect(ASSETS.map((a) => `${a.id}:${a.status}`)).toEqual([
      'wordnet:pinned',
      'wordfreq:pinned',
      'dakshina:pinned',
      'en-in-words:pinned',
      'tech-words:pinned',
      'local-llm:pinned',
      'llama-server:pinned',
      'llama-server-vulkan:pinned',
    ]);
  });

  // The model and llama-server are not committed: the user picks the model, and fetch-llama checks its own files.
  const committed = pinned.filter((a) => a.localPath !== null);

  it('commits every pinned asset except the model and the llama-server builds', () => {
    expect(pinned.filter((a) => a.localPath === null).map((a) => a.id)).toEqual(['local-llm', ...LLAMA_BUILDS]);
  });

  it.each(committed.map((a) => [a.id, a] as const))('%s: the committed file matches its outputSha256', (_id, asset) => {
    expect(sha256File(asset.localPath!)).toBe(asset.outputSha256);
  });

  it.each(pinned.map((a) => [a.id, a] as const))('%s: has a version, source, sha256 and an allowed data licence', (_id, asset) => {
    expect(asset.version).toBeTruthy();
    expect(asset.sourceUrl).toBeTruthy();
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(checkLicence(asset.licence ?? undefined, 'data')).toEqual({ ok: true });
  });

  it('keeps planned entries out of hash checks: they carry no hashes yet', () => {
    for (const asset of ASSETS.filter((a) => a.status === 'planned')) {
      expect(asset.sha256).toBeNull();
      expect(asset.outputSha256).toBeNull();
    }
  });

  it('is where the build scripts take the source hash they verify from', () => {
    expect(DICTIONARY_SHA).toBe('9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe');
    expect(FREQUENCY_SHA).toBe(pinnedSha256('wordfreq'));
    expect(ROMANISED_SHA).toBe(pinnedSha256('dakshina'));
    expect(DICTIONARY_SHA).toBe(pinnedSha256('wordnet'));
  });

  it.each(LLAMA_BUILDS)('%s: pins b11727 file by file, its exe hash under sha256', (id) => {
    const llama = ASSETS.find((a) => a.id === id)!;
    expect(llama.version).toBe('b11727');
    expect(llama.files!['llama-server.exe']).toBe(llama.sha256);
    for (const hash of Object.values(llama.files!)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an unknown asset', () => {
    expect(() => pinnedSha256('context-model')).toThrow('No asset "context-model" in deps/assets.json.');
  });
});
