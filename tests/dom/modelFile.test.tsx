// Settings › Modules › AI rewrites: the model file picker (Task 12).
import { describe, it, expect, vi } from 'vitest';
import axe from 'axe-core';
import { act, screen, within } from '@testing-library/react';
import { createLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import { SessionController } from '@/ui/state/sessionController';
import { defaultSettings } from '@/ui/state/settings';
import { makeController, noFiles } from './harness';
import { chooseFromMore, renderShell, settingsTab } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const QWEN = 'ff5c3e9740a5aa53f04fdf3b0b8cc75da556bf8948cdb19d61c512d3a43465d9';

function openModelFile(settings: Parameters<typeof makeController>[0]) {
  renderShell(makeController(settings).controller);
  chooseFromMore('Settings');
  settingsTab('Modules');
  return screen.getByRole('group', { name: /Model file/ });
}

describe('the model file picker', () => {
  it('without a model: says so, and AI rewrites cannot be switched on', () => {
    const group = openModelFile({});
    expect(within(group).getByText('No model file chosen.')).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Choose model file…' })).toBeTruthy();
    expect(within(group).getByText('A .gguf file on this computer. The app never downloads models.')).toBeTruthy();
    expect((screen.getByRole('switch', { name: /AI rewrites/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it('a known model is named with its licence; the switch can be used', () => {
    const group = openModelFile({ modelPath: 'C:\\models\\Qwen3.5-4B-IQ4_NL.gguf', modelSha256: QWEN });
    expect(within(group).getByText(/Qwen3\.5-4B-IQ4_NL\.gguf/)).toBeTruthy();
    expect(within(group).getByText('Qwen3.5-4B (IQ4_NL), licence Apache-2.0')).toBeTruthy();
    expect((screen.getByRole('switch', { name: /AI rewrites/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it('any other file is flagged as unknown', () => {
    const group = openModelFile({ modelPath: '/models/other.gguf', modelSha256: '0'.repeat(64) });
    expect(within(group).getByText('Unknown model; use at your own risk')).toBeTruthy();
  });

  it('has no serious or critical accessibility violations', async () => {
    openModelFile({ modelPath: '/models/other.gguf', modelSha256: '0'.repeat(64) });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    const results = await axe.run(document.body, { resultTypes: ['violations'] });
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
});

describe('without the AI helper installed (the version without AI, Task 14 fix round 1)', () => {
  // AI rewrites were switched on with a model, as in an earlier install that had the helper.
  const controller = () =>
    new SessionController({
      files: noFiles,
      createLinter: (variant, words) => createLinter(variant, words),
      saveSettings: async () => {},
      settings: { ...defaultSettings('en-US'), preset: 'academic', modelPath: 'C:/models/a.gguf', modules: { ...DEFAULT_MODULES, aiRewrites: true } },
      helperInstalled: false,
    });

  it('Settings says the AI helper is not installed, offers no model file, and AI rewrites stay off', () => {
    const c = controller();
    renderShell(c);
    chooseFromMore('Settings');
    settingsTab('Modules');
    const ai = screen.getByRole('switch', { name: /AI rewrites/ }) as HTMLInputElement;
    expect(ai.disabled).toBe(true);
    expect(ai.checked).toBe(false);
    expect(screen.getByText(/AI helper not installed\./)).toBeTruthy();
    expect(screen.queryByRole('group', { name: /Model file/ })).toBeNull();
    expect(c.ai.available()).toBe(false);
  });
});
