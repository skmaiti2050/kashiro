// Third-party notices for the i18n library (Task L1 fix round 1): the BSD-3 and MIT texts ship with the app.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const NOTICES = 'resources/i18n/ATTRIBUTION.md';
const PACKAGES = ['react-intl', 'intl-messageformat', '@formatjs/intl', '@formatjs/icu-messageformat-parser', '@formatjs/icu-skeleton-parser', '@formatjs/fast-memoize'];

describe('i18n third-party notices', () => {
  const notices = readFileSync(NOTICES, 'utf8');

  it.each(PACKAGES)('%s is listed with its installed version and licence', (name) => {
    const pkg = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')) as { version: string; license: string };
    expect(notices).toContain(`| \`${name}\` | ${pkg.version} | ${pkg.license} |`);
  });

  it.each(PACKAGES)('%s: its copyright line from the package LICENSE is reproduced', (name) => {
    const license = readFileSync(`node_modules/${name}/LICENSE.md`, 'utf8');
    const copyright = license.split('\n').find((line) => line.startsWith('Copyright'))!;
    expect(notices).toContain(copyright.trim());
  });

  it('carries the full BSD-3-Clause and MIT texts', () => {
    expect(notices).toContain('Neither the name of the Oath Inc. nor the');
    expect(notices).toContain('written permission of Oath Inc.');
    expect(notices).toContain('Permission is hereby granted, free of charge, to any person obtaining a copy');
  });
});
