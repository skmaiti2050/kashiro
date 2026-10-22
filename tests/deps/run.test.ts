import { describe, expect, it } from 'vitest';
import { argumentAfter, runTool } from '../../scripts/deps/run';

describe('runTool', () => {
  it('reports a tool that is not installed as missing instead of throwing (deps:status skips it)', () => {
    expect(runTool('writing-check-no-such-tool --version', process.cwd()).status).toBe('missing');
    expect(runTool('cargo writing-check-no-such-subcommand', process.cwd()).status).toBe('missing');
  });

  it('reports a failing command as failed, with its exit code', () => {
    const result = runTool('node -e "process.exit(3)"', process.cwd());
    expect(result).toMatchObject({ status: 'failed', exitCode: 3 });
  });

  it('captures the output of a command that works', () => {
    expect(runTool('node -e "console.log(42)"', process.cwd())).toMatchObject({ status: 'ok', exitCode: 0, stdout: '42\n' });
  });
});

describe('argumentAfter', () => {
  it('reads the value after a flag', () => {
    expect(argumentAfter(['node', 'x', '--samples', 'pack'], '--samples')).toBe('pack');
    expect(argumentAfter(['node', 'x'], '--samples')).toBeUndefined();
  });
});
