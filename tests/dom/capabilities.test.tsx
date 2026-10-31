// Web Task 1: the platform's capabilities hide what the web build can't do (updates, AI rewrites, the model file),
// and About says where AI rewrites are. With the desktop capabilities everything shows, as before.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { Capabilities } from '@/ui/platform/capabilities';
import type { Settings } from '@/ui/state/settings';
import { makeController } from './harness';
import { chooseFromMore, renderShell, settingsTab } from './shell';

const DESKTOP: Capabilities = { ai: true, windowMemory: true, updates: true, textDrop: false, saveInPlace: 'native', web: false };
const WEB: Capabilities = { ai: false, windowMemory: false, updates: false, textDrop: true, saveInPlace: 'download', web: true };

const platform = vi.hoisted(() => ({ capabilities: {} as Capabilities }));
vi.mock('@/ui/platform/capabilities', () => platform);
vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const WEB_AI = 'AI rewrites are available in the desktop app';
/** Settings › Saving's desktop hint about saved reviews (Web Task 3: the web's storage note says where they are). */
const APP_FOLDER_HINT = 'Kept in the app’s own folder on this computer';

function savingSettingsText(): string {
  chooseFromMore('Settings');
  settingsTab('Saving');
  return screen.getByRole('dialog', { name: 'Settings' }).textContent ?? '';
}

function moreMenuItems(): string[] {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  const names = screen.getAllByRole('menuitem').map((item) => (item.textContent ?? '').trim());
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  return names;
}

function paletteEntries(): string[] {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
  const names = within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.querySelector('.palette-label')!.textContent ?? '');
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Type a command' }),{ key: 'Escape' });
  return names;
}

function openModulesSettings(): void {
  chooseFromMore('Settings');
  settingsTab('Modules');
}

/** AI rewrites switched on with a timed model file: the desktop offers "Improve this sentence" everywhere. */
const AI_ON: Partial<Settings> = {
  modelPath: 'C:/models/helper.gguf',
  modules: { ...DEFAULT_MODULES, aiRewrites: true },
  helperSpeed: { modelPath: 'C:/models/helper.gguf', seconds: 2.5, backend: 'cpu', gpuFallback: false },
};
const IMPROVE_ROW = 'Improve the sentence at the cursor (AI helper)';

function shortcutsText(): string {
  chooseFromMore('Keyboard shortcuts');
  return screen.getByRole('dialog', { name: 'Keyboard shortcuts' }).textContent ?? '';
}

async function aboutText(): Promise<string> {
  chooseFromMore('About');
  return (await screen.findByRole('dialog', { name: 'About Kashiro' })).textContent ?? '';
}

describe('with the web capabilities', () => {
  beforeEach(() => {
    platform.capabilities = WEB;
  });

  it('⋯ and the command palette have no "Check for updates…"', () => {
    renderShell(makeController().controller);
    expect(moreMenuItems()).not.toContain('Check for updates…');
    expect(paletteEntries()).not.toContain('Check for updates…');
  });

  it('Settings has no AI rewrites switch and no model file', () => {
    renderShell(makeController().controller);
    openModulesSettings();
    expect(screen.queryByRole('switch', { name: /AI rewrites/ })).toBeNull();
    expect(screen.queryByRole('group', { name: /Model file/ })).toBeNull();
    expect(screen.getByRole('switch', { name: /Word lookup/ })).toBeTruthy();
  });

  it('About says AI rewrites are in the desktop app, marks the preview, and has no Check for updates', async () => {
    renderShell(makeController().controller);
    const text = await aboutText();
    expect(text).toContain(WEB_AI);
    expect(text).toContain('Preview');
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
  });

  it('Settings › Saving has no "app’s own folder" hint', () => {
    renderShell(makeController().controller);
    expect(savingSettingsText()).not.toContain(APP_FOLDER_HINT);
  });

  it('even with AI rewrites on in the saved settings, the shortcuts have no AI row', () => {
    renderShell(makeController(AI_ON).controller);
    const text = shortcutsText();
    expect(text).not.toContain(IMPROVE_ROW);
    expect(text).not.toContain('Ctrl+I');
  });
});

describe('with the desktop capabilities', () => {
  beforeEach(() => {
    platform.capabilities = DESKTOP;
  });

  it('⋯ and the command palette have "Check for updates…"', () => {
    renderShell(makeController().controller);
    expect(moreMenuItems()).toContain('Check for updates…');
    expect(paletteEntries()).toContain('Check for updates…');
  });

  it('Settings has the AI rewrites switch and the model file', () => {
    renderShell(makeController().controller);
    openModulesSettings();
    expect(screen.getByRole('switch', { name: /AI rewrites/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Model file/ })).toBeTruthy();
  });

  it('About has Check for updates and no web note', async () => {
    renderShell(makeController().controller);
    const text = await aboutText();
    expect(text).not.toContain(WEB_AI);
    expect(text).not.toContain('Preview');
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy();
  });

  it('Settings › Saving has the "app’s own folder" hint', () => {
    renderShell(makeController().controller);
    expect(savingSettingsText()).toContain(APP_FOLDER_HINT);
  });

  it('with AI rewrites on: the shortcuts list "Improve the sentence (AI helper)" with Ctrl+I', () => {
    renderShell(makeController(AI_ON).controller);
    const text = shortcutsText();
    expect(text).toContain(IMPROVE_ROW);
    expect(text).toContain('Ctrl+I');
  });
});
