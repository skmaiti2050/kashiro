/** src/engine runs in Node and the browser and knows nothing of the UI (CLAUDE.md): no import from src/ui, not even a type. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE = join(__dirname, '..', '..', 'src', 'engine');
/**
 * An import or re-export from the UI, its index included: `from '../ui'`, `from '@/ui/state'`, `import '../ui/x'`,
 * `import('../../ui/x')`.
 */
const UI_IMPORT = /(?:from\s*|import\s*\(?\s*)['"](?:@\/ui|(?:\.\.\/)+ui)(?:\/|['"])/;
const SOURCE_FILE = /\.tsx?$/;

describe('engine layering', () => {
  it('the pattern catches every form of UI import', () => {
    for (const line of [`from '../ui'`, `from "@/ui/state"`, `import '../ui/x';`, `import('../../ui/x')`, `export * from '../ui/i18n'`]) {
      expect(UI_IMPORT.test(line), line).toBe(true);
    }
    expect(UI_IMPORT.test(`from './uiText'`)).toBe(false);
  });

  it('no file under src/engine imports from src/ui', () => {
    const files = readdirSync(ENGINE, { recursive: true, encoding: 'utf8' }).filter((f) => SOURCE_FILE.test(f));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => UI_IMPORT.test(readFileSync(join(ENGINE, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
