// Task 14 fix round 2: `npm run release` builds the four release files.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RELEASE_FILES } from '../../scripts/release';

const ROOT = path.resolve(__dirname, '../..');

describe('npm run release', () => {
  it('builds both installers and both zips', () => {
    expect(RELEASE_FILES).toEqual([
      'src-tauri/target/release/bundle/nsis/writing-check-noai_1.0.0_x64-setup.exe',
      'src-tauri/target/release/bundle/nsis/writing-check_1.0.0_x64-setup.exe',
      'dist-portable/writing-check-1.0.0-win-x64.zip',
      'dist-portable/writing-check-1.0.0-win-x64-noai.zip',
    ]);
  });

  it('is an npm script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.release).toBe('tsx scripts/release.ts');
  });
});
