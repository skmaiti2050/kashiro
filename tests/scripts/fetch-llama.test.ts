import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { BUILDS, copyLlamaServer, filesInZip, hashMismatches, installedBuildProblems, installLlamaServer, pinnedFiles, releaseZip } from '../../scripts/fetch-llama';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('fetch-llama', () => {
  it('pins one llama folder from the CPU zip, and only the Vulkan backend from the Vulkan zip (fix round 1)', () => {
    expect(BUILDS.map((b) => b.folder)).toEqual(['llama', 'vulkan']);
    const llama = pinnedFiles('llama-server');
    expect(llama['llama-server.exe']).toMatch(/^[0-9a-f]{64}$/);
    expect(llama).not.toHaveProperty('ggml-vulkan.dll');
    expect(Object.keys(pinnedFiles('llama-server-vulkan'))).toEqual(['ggml-vulkan.dll']);
  });

  it('tauri.conf.json bundles the server in llama/ and the Vulkan backend alone in llama/vulkan/, and no sidecar', () => {
    const conf = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8'));
    expect(conf.bundle.externalBin).toBeUndefined();
    expect(conf.bundle.resources['binaries/llama/*']).toBe('llama/');
    expect(conf.bundle.resources['binaries/vulkan/*']).toBe('llama/vulkan/');
    expect(conf.bundle.resources['binaries/cpu/*']).toBeUndefined();
  });

  it('installing removes files its own folder should not have, and the check reports a folder that differs', () => {
    const binaries = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-llama-'));
    const target = path.join(binaries, 'llama');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'stale.dll'), 'old');
    const pinned = { 'llama-server.exe': sha('exe') };
    installLlamaServer({ 'llama-server.exe': Buffer.from('exe') }, 'the zip', target, pinned);
    expect(fs.readdirSync(target)).toEqual(['llama-server.exe']);

    const builds = [{ folder: 'llama', pinned }, { folder: 'vulkan', pinned: { 'ggml-vulkan.dll': sha('vk') } }];
    expect(installedBuildProblems(binaries, builds)).toEqual([`vulkan: missing (${path.join(binaries, 'vulkan')}): run npm run fetch:llama`]);
    fs.mkdirSync(path.join(binaries, 'vulkan'));
    fs.writeFileSync(path.join(binaries, 'vulkan', 'ggml-vulkan.dll'), 'vk');
    fs.writeFileSync(path.join(binaries, 'llama', 'extra.dll'), 'x');
    fs.writeFileSync(path.join(binaries, 'llama', 'llama-server.exe'), 'changed');
    expect(installedBuildProblems(binaries, builds)).toEqual([`llama: llama-server.exe: sha256 is ${sha('changed')}, expected ${sha('exe')}`, 'llama: extra.dll: not pinned']);
    fs.rmSync(binaries, { recursive: true });
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

  it('pins the official release zips by URL and sha256 (Task 14)', () => {
    expect(BUILDS.map((b) => releaseZip(b.assetId))).toEqual([
      {
        url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11727/llama-b11727-bin-win-cpu-x64.zip',
        sha256: 'd71a767fd77b2509cc4698d1017d9820b49b0bfaabf5aef7d1ea7e0696d80a71',
      },
      {
        url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11727/llama-b11727-bin-win-vulkan-x64.zip',
        sha256: 'c373936fb9578ac85d2e5c3d220821eddae4288283237b01d9618419175f127b',
      },
    ]);
  });

  it('takes only the pinned files out of a release zip, after checking the zip itself', async () => {
    const zip = new JSZip();
    zip.file('llama-server.exe', 'exe');
    zip.file('llama-cli.exe', 'not shipped');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const pinned = { 'llama-server.exe': sha('exe'), 'ggml.dll': sha('dll') };

    const files = await filesInZip(bytes, createHash('sha256').update(bytes).digest('hex'), pinned);
    expect(Object.keys(files)).toEqual(['llama-server.exe']);
    expect(files['llama-server.exe'].toString()).toBe('exe');
    await expect(filesInZip(bytes, sha('another zip'), pinned)).rejects.toThrow(/zip's sha256 is [0-9a-f]{64}, expected/);
  });

  it('installs from a zip only when every pinned file is there and matches', () => {
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-llama-')), 'cpu');
    const pinned = { 'llama-server.exe': sha('exe'), 'ggml.dll': sha('dll') };
    expect(() => installLlamaServer({ 'llama-server.exe': Buffer.from('exe') }, 'the zip', target, pinned)).toThrow('ggml.dll: missing');
    expect(fs.existsSync(target)).toBe(false);
    installLlamaServer({ 'llama-server.exe': Buffer.from('exe'), 'ggml.dll': Buffer.from('dll') }, 'the zip', target, pinned);
    expect(fs.readdirSync(target).sort()).toEqual(['ggml.dll', 'llama-server.exe']);
    fs.rmSync(path.dirname(target), { recursive: true });
  });
});
