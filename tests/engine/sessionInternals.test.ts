/** CheckSession's modules share its private state (SessionState): only the session's own files may import them. */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const ENGINE = join(ROOT, 'src', 'engine');
/** An import of one of the session's internal modules, such as `./sessionState` or `../../src/engine/sessionEdits`. */
const SESSION_MODULE_IMPORT = /from '.*\/session(State|Decisions|Edits|Intake|Dictionary)'/;
const SOURCE_FILE = /\.tsx?$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => SOURCE_FILE.test(f))
    .map((f) => join(dir, f));
}

describe('session internals', () => {
  it('the session modules are engine-internal', () => {
    const files = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'tests'))];
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((f) => SESSION_MODULE_IMPORT.test(readFileSync(f, 'utf8')))
      .filter((f) => !(dirname(f) === ENGINE && basename(f).startsWith('session')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
