import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BUILDS, copyLlamaServer, hashMismatches, pinnedFiles } from '../../scripts/fetch-llama';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('fetch-llama', () => {
  it('pins a CPU and a Vulkan build of the same release; the Vulkan one adds only its backend', () => {
    expect(BUILDS.map((b) => b.folder)).toEqual(['cpu', 'vulkan']);
    const cpu = pinnedFiles('llama-server');
    const vulkan = pinnedFiles('llama-server-vulkan');
    expect(cpu['llama-server.exe']).toMatch(/^[0-9a-f]{64}$/);
    expect(cpu).not.toHaveProperty('ggml-vulkan.dll');
    const { 'ggml-vulkan.dll': backend, ...shared } = vulkan;
    expect(backend).toMatch(/^[0-9a-f]{64}$/);
    expect(shared).toEqual(cpu);
  });

  it('tauri.conf.json bundles each build folder as a resource of the same name, and no sidecar', () => {
    const conf = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8'));
    expect(conf.bundle.externalBin).toBeUndefined();
    for (const { folder } of BUILDS) expect(conf.bundle.resources[`binaries/${folder}/*`]).toBe(`llama/${folder}/`);
  });

  it('reports a missing file and a changed file by name', () => {
    const pinned = { 'a.dll': sha('a'), 'b.dll': sha('b') };
    expect(hashMismatches(pinned, { 'a.dll': sha('a'), 'b.dll': sha('b') })).toEqual([]);
    expect(hashMismatches(pinned, { 'a.dll': sha('changed') })).toEqual([
      `a.dll: sha256 is ${sha('changed')}, expected ${sha('a')}`,
      'b.dll: missing',
    ]);
  });

  it('copies verified files, and copies nothing when one hash is wrong', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-llama-'));
    const source = path.join(root, 'source');
    const target = path.join(root, 'binaries', 'cpu');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'llama-server.exe'), 'exe');
    fs.writeFileSync(path.join(source, 'ggml.dll'), 'dll');
    const pinned = { 'llama-server.exe': sha('exe'), 'ggml.dll': sha('dll') };

    expect(() => copyLlamaServer(source, target, { ...pinned, 'ggml.dll': sha('other') })).toThrow(/ggml\.dll: sha256 is/);
    expect(fs.existsSync(target)).toBe(false);

    copyLlamaServer(source, target, pinned);
    expect(fs.readFileSync(path.join(target, 'llama-server.exe'), 'utf8')).toBe('exe');
    expect(fs.readFileSync(path.join(target, 'ggml.dll'), 'utf8')).toBe('dll');
    fs.rmSync(root, { recursive: true });
  });
});
