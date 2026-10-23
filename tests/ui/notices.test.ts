// Task 11b UI: About › Third-party notices shows the committed notice files, word for word, and the dictionary
// ships as a bundled resource (not in the JS bundle).
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
    ]);
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

  it('the dictionary is a Tauri resource at dictionary/oewn.json.gz', () => {
    // The other resources are the two llama-server builds (tests/scripts/fetch-llama.test.ts).
    expect(tauriConf().bundle.resources).toEqual({
      '../resources/dictionary/oewn.json.gz': 'dictionary/oewn.json.gz',
      'binaries/cpu/*': 'llama/cpu/',
      'binaries/vulkan/*': 'llama/vulkan/',
    });
  });
});
