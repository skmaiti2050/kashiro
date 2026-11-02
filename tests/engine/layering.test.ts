/** src/engine runs in Node and the browser and knows nothing of the UI (CLAUDE.md): no import from src/ui, not even a type. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE = join(__dirname, '..', '..', 'src', 'engine');
/** An import or re-export from the UI: `from '../ui/i18n'`, `from '@/ui/state'`, `import('../../ui/x')`. */
const UI_IMPORT = /(?:from\s+|import\s*\(\s*)['"](?:@\/ui|(?:\.\.\/)+ui)\//;

describe('engine layering', () => {
  it('no file under src/engine imports from src/ui', () => {
    const files = readdirSync(ENGINE, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => UI_IMPORT.test(readFileSync(join(ENGINE, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
