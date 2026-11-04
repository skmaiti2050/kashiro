/** src/engine runs in Node and the browser and knows nothing of the UI (CLAUDE.md): no import from src/ui, not even a type. */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const ENGINE = join(ROOT, 'src', 'engine');
/**
 * An import or re-export from the UI, its index included: `from '../ui'`, `from '@/ui/state'`, `import '../ui/x'`,
 * `import('../../ui/x')`.
 */
const UI_IMPORT = /(?:from\s*|import\s*\(?\s*)['"](?:@\/ui|(?:\.\.\/)+ui)(?:\/|['"])/;
/** Any quoted path to one of the session's internal modules: `from './sessionState'`, `vi.mock("../src/engine/sessionEdits")`. */
const SESSION_MODULE_IMPORT = /['"][^'"]*\/session(?:State|Decisions|Edits|Intake|Dictionary)['"]/;
const SOURCE_FILE = /\.tsx?$/;

/** Every .ts/.tsx file under `dir`, as full paths. */
function sourceFiles(dir: string): string[] {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => SOURCE_FILE.test(f)).map((f) => join(dir, f));
  expect(files.length).toBeGreaterThan(0);
  return files;
}

describe('engine layering', () => {
  it('the pattern catches every form of UI import', () => {
    for (const line of [`from '../ui'`, `from "@/ui/state"`, `import '../ui/x';`, `import('../../ui/x')`, `export * from '../ui/i18n'`]) {
      expect(UI_IMPORT.test(line), line).toBe(true);
    }
    expect(UI_IMPORT.test(`from './uiText'`)).toBe(false);
  });

  it('no file under src/engine imports from src/ui', () => {
    const offenders = sourceFiles(ENGINE).filter((f) => UI_IMPORT.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the pattern catches every form of session-module import', () => {
    for (const line of [`from './sessionState'`, `from "../../src/engine/sessionEdits"`, `vi.mock('../src/engine/sessionIntake')`, `import('./sessionDictionary')`]) {
      expect(SESSION_MODULE_IMPORT.test(line), line).toBe(true);
    }
    expect(SESSION_MODULE_IMPORT.test(`from './session'`)).toBe(false);
    expect(SESSION_MODULE_IMPORT.test(`from './sessionTypes'`)).toBe(false);
  });

  // CheckSession's modules share its private state (SessionState): only the session's own files may import them (#33).
  it('only the session files import the session modules', () => {
    const offenders = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'tests'))]
      .filter((f) => SESSION_MODULE_IMPORT.test(readFileSync(f, 'utf8')))
      .filter((f) => !(dirname(f) === ENGINE && basename(f).startsWith('session')) && f !== __filename)
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
