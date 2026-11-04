import { describe, it, expect, vi } from 'vitest';
import { createScriptEngines } from '@/engine/scriptEngines';
import { SessionController } from '@/ui/state/sessionController';
import { defaultSettings } from '@/ui/state/settings';

vi.mock('@/engine/scriptEngines', () => ({ createScriptEngines: vi.fn(() => new Map()) }));

const files = { open: async () => null, save: async (path: string) => ({ path, backup: null }) };
const baseDeps = () => ({
  files,
  createLinter: async () => {
    throw new Error('not needed');
  },
  saveSettings: async () => {},
  settings: defaultSettings('en-US'),
});

describe('the script engine registry', () => {
  it('the controller builds its engines from the registry when none are passed', () => {
    vi.mocked(createScriptEngines).mockClear();
    new SessionController(baseDeps());
    expect(createScriptEngines).toHaveBeenCalledTimes(1);
  });

  it('engines passed in are used instead', () => {
    vi.mocked(createScriptEngines).mockClear();
    new SessionController({ ...baseDeps(), scriptEngines: new Map() });
    expect(createScriptEngines).not.toHaveBeenCalled();
  });
});
