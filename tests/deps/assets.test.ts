import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, licenceUseOf, pinnedSha256 } from '../../scripts/deps/assets';
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
      'vc-runtime:pinned',
    ]);
  });

  // The model and the binaries are not committed: the user picks the model, and fetch-llama checks its own files.
  const committed = pinned.filter((a) => a.localPath !== null);

  it('commits every pinned asset except the model and the bundled binaries', () => {
    expect(pinned.filter((a) => a.localPath === null).map((a) => a.id)).toEqual(['local-llm', ...LLAMA_BUILDS, 'vc-runtime']);
  });

  it('pins the Visual C++ runtime that llama-server needs: 14.51 or later, from the official redistributable (fix round 2)', () => {
    const runtime = ASSETS.find((a) => a.id === 'vc-runtime')!;
    expect(runtime.version).toBe('14.51.36247');
    expect(runtime.sourceUrl).toBe('https://aka.ms/vc14/vc_redist.x64.exe');
    expect(runtime.archiveSha256).toBe('843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c');
    expect(runtime.files).toEqual({
      'msvcp140.dll': '7c26614e1d733892c2deac7e245ce115504b1d80592dd0a01b08e3e5a55f89ca',
      'vcruntime140.dll': 'd1f4225df2cd877dbf130d5668a021dce3f94118455ff5ec952061c30afc9ce7',
      'vcruntime140_1.dll': 'a7146c08f89fe5b04541ab507cdb59ff7b44534d4ba3c668a426c6450a03434e',
    });
    expect(licenceUseOf(runtime)).toBe('binary');
  });

  it.each(committed.map((a) => [a.id, a] as const))('%s: the committed file matches its outputSha256', (_id, asset) => {
    expect(sha256File(asset.localPath!)).toBe(asset.outputSha256);
  });

  it.each(pinned.map((a) => [a.id, a] as const))('%s: has a version, source, sha256 and an allowed licence for its use', (_id, asset) => {
    expect(asset.version).toBeTruthy();
    expect(asset.sourceUrl).toBeTruthy();
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(checkLicence(asset.licence ?? undefined, licenceUseOf(asset))).toEqual({ ok: true });
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

  it.each([
    ['llama-server', 'llama-server.exe'],
    ['llama-server-vulkan', 'ggml-vulkan.dll'],
  ])('%s: pins b11727 file by file, the hash of %s under sha256', (id, main) => {
    const llama = ASSETS.find((a) => a.id === id)!;
    expect(llama.version).toBe('b11727');
    expect(llama.files![main]).toBe(llama.sha256);
    for (const hash of Object.values(llama.files!)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an unknown asset', () => {
    expect(() => pinnedSha256('context-model')).toThrow('No asset "context-model" in deps/assets.json.');
  });
});
