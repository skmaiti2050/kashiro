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

describe('deps/assets.json', () => {
  const pinned = ASSETS.filter((a) => a.status === 'pinned');

  it('lists the data files and the planned model and llama-server, without the dropped context model', () => {
    expect(ASSETS.map((a) => `${a.id}:${a.status}`)).toEqual([
      'wordnet:pinned',
      'wordfreq:pinned',
      'dakshina:pinned',
      'en-in-words:pinned',
      'tech-words:pinned',
      'local-llm:planned',
      'llama-server:planned',
    ]);
  });

  it.each(pinned.map((a) => [a.id, a] as const))('%s: the committed file matches its outputSha256', (_id, asset) => {
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

  it('refuses a planned or unknown asset', () => {
    expect(() => pinnedSha256('local-llm')).toThrow('local-llm is not pinned yet (status "planned") in deps/assets.json.');
    expect(() => pinnedSha256('context-model')).toThrow('No asset "context-model" in deps/assets.json.');
  });
});
