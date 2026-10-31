// Task 11b UI: About › Third-party notices shows the committed notice files, word for word, and the dictionary
// ships as a bundled resource (not in the JS bundle).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { APP_VERSION, THIRD_PARTY_NOTICES } from '@/ui/notices';

const NOTICE_FILES = [
  'resources/dictionary/ATTRIBUTION.md',
  'resources/frequency/ATTRIBUTION.md',
  'resources/romanised/ATTRIBUTION.md',
  'resources/fonts/ATTRIBUTION.md',
  'resources/i18n/ATTRIBUTION.md',
  'resources/harper/ATTRIBUTION.md',
  'resources/llama/ATTRIBUTION.md',
  'resources/notices/THIRD-PARTY-NOTICES.txt',
];

const tauriConf = () => JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as { version: string; bundle: { resources?: Record<string, string> } };

describe('third-party notices (About)', () => {
  it('shows every committed notice file, unchanged and in order', () => {
    expect(THIRD_PARTY_NOTICES.map((n) => n.text)).toEqual(NOTICE_FILES.map((path) => readFileSync(path, 'utf8')));
  });

  it('each notice has a title naming what it covers', () => {
    expect(THIRD_PARTY_NOTICES.map((n) => n.title)).toEqual([
      'Open English WordNet (word lookup)',
      'wordfreq (word frequencies)',
      'Dakshina dataset (words in Indian languages)',
      'Fonts (SIL Open Font License)',
      'react-intl, intl-messageformat and FormatJS (interface text)',
      'Harper (grammar and spelling checker)',
      'llama.cpp (writing helper)',
      'Other libraries (JavaScript packages and Rust crates)',
    ]);
  });

  it('the llama.cpp notice carries the release’s own licence texts; its LLVM OpenMP text is the pinned file', () => {
    const llama = THIRD_PARTY_NOTICES[6].text;
    for (const line of [
      'Copyright (c) 2023-2026 The ggml authors',
      'Copyright (c) 2013-2025 Niels Lohmann',
      'Copyright (c) 2017 yhirose',
      'Licenses for support code',
      // The bundled Visual C++ runtime (fix round 2): its version and Microsoft's terms.
      'Microsoft Visual C++ v14 Redistributable (x64) - 14.51.36247',
      'https://aka.ms/VCRedistLicense',
    ]) {
      expect(llama).toContain(line);
    }
    const llvm = llama.slice(llama.indexOf('```\n', llama.indexOf('## LLVM OpenMP')) + 4, llama.lastIndexOf('```'));
    const pinned = (JSON.parse(readFileSync('deps/assets.json', 'utf8')) as { assets: { id: string; files?: Record<string, string> }[] }).assets;
    const llvmSha = pinned.find((a) => a.id === 'llama-server')!.files!['LICENSE-LLVM-OpenMP'];
    expect(createHash('sha256').update(llvm).digest('hex')).toBe(llvmSha);
  });

  it('the dictionary notice carries CC BY 4.0 and Princeton’s WordNet licence, with its no-promotion term', () => {
    const dictionary = THIRD_PARTY_NOTICES[0].text;
    expect(dictionary).toContain('Creative Commons Attribution 4.0 International License');
    expect(dictionary).toContain('WordNet 3.1 Copyright 2011 by Princeton University.');
    expect(dictionary).toContain('The name of Princeton University or Princeton may not be used in');
  });

  it('the fonts notice carries the full SIL Open Font License', () => {
    const fonts = THIRD_PARTY_NOTICES[3].text;
    expect(fonts).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(fonts).toContain('TERMINATION');
  });
});

describe('Harper notice', () => {
  const notice = readFileSync('resources/harper/ATTRIBUTION.md', 'utf8');
  const pkg = JSON.parse(readFileSync('node_modules/harper.js/package.json', 'utf8')) as { version: string; license: string };

  it('lists harper.js with its installed version and licence', () => {
    expect(notice).toContain(`| \`harper.js\` | ${pkg.version} | ${pkg.license} |`);
  });

  it('reproduces the package LICENSE (Apache-2.0, with Automattic’s copyright) word for word', () => {
    const license = readFileSync('node_modules/harper.js/LICENSE', 'utf8').replace(/\r\n/g, '\n').trim();
    expect(notice.replace(/\r\n/g, '\n')).toContain(license);
    expect(license).toContain('Copyright 2024 Automattic Inc.');
  });
});

describe('app version and bundled dictionary', () => {
  it('About shows the version the installer is built with', () => {
    expect(APP_VERSION).toBe(tauriConf().version);
  });

  it('the release is 1.0.1 in package.json, tauri.conf.json, Cargo.toml and both lockfiles', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { version: string; packages: Record<string, { version: string }> };
    const cargoToml = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)![1];
    const cargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8').match(/name = "writing-check"\r?\nversion = "([^"]+)"/)![1];
    expect([APP_VERSION, tauriConf().version, lock.version, lock.packages[''].version, cargoToml, cargoLock]).toEqual(Array(6).fill('1.0.1'));
  });

  it('bundles the dictionary, both llama-server builds, and every notice beside the app (Task 14)', () => {
    expect(tauriConf().bundle.resources).toEqual({
      '../resources/dictionary/oewn.json.gz': 'dictionary/oewn.json.gz',
      'binaries/llama/*': 'llama/',
      'binaries/vulkan/*': 'llama/vulkan/',
      '../LICENSE': 'LICENSE.txt',
      '../README.md': 'README.md',
      '../docs/INSTALL.md': 'INSTALL.md',
      '../resources/dictionary/ATTRIBUTION.md': 'notices/dictionary.md',
      '../resources/frequency/ATTRIBUTION.md': 'notices/word-frequencies.md',
      '../resources/romanised/ATTRIBUTION.md': 'notices/indian-languages.md',
      '../resources/fonts/ATTRIBUTION.md': 'notices/fonts.md',
      '../resources/i18n/ATTRIBUTION.md': 'notices/interface-text.md',
      '../resources/harper/ATTRIBUTION.md': 'notices/harper.md',
      '../resources/llama/ATTRIBUTION.md': 'notices/llama-cpp.md',
      '../resources/notices/THIRD-PARTY-NOTICES.txt': 'notices/THIRD-PARTY-NOTICES.txt',
    });
  });

  it('every notice shown in About is also a file in the install folder', () => {
    const sources = Object.keys(tauriConf().bundle.resources ?? {});
    for (const file of NOTICE_FILES) expect(sources).toContain(`../${file}`);
  });
});
