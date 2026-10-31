// Final review items 2, 4, 7 and R2: the web build never promises what only the desktop does. No .bak backup in the
// Save menu or Settings › Saving, no Overwrite at all where Save downloads, About's privacy note says what the
// web does, and saved reviews and voices are about this browser, not "this computer" or Windows Settings.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { Capabilities } from '@/ui/platform/capabilities';
import { makeController } from './harness';
import { chooseFromMore, renderShell, settingsTab } from './shell';

const DESKTOP: Capabilities = { ai: true, windowMemory: true, updates: true, textDrop: false, saveInPlace: 'native', web: false };
const PICKER: Capabilities = { ai: false, windowMemory: false, updates: false, textDrop: true, saveInPlace: 'picker', web: true };
const DOWNLOAD: Capabilities = { ...PICKER, saveInPlace: 'download' };

const platform = vi.hoisted(() => ({ capabilities: {} as Capabilities }));
vi.mock('@/ui/platform/capabilities', () => platform);
vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const NO_BACKUP = 'No backup on the web: the original is replaced.';

function saveMenuText(): string {
  fireEvent.click(screen.getByLabelText('Save options'));
  return document.querySelector('.save-menu .menu')!.textContent ?? '';
}

function savingSettings(): HTMLElement {
  chooseFromMore('Settings');
  settingsTab('Saving');
  return screen.getByRole('dialog', { name: 'Settings' });
}

async function aboutText(): Promise<string> {
  chooseFromMore('About');
  return (await screen.findByRole('dialog', { name: 'About Kashiro' })).textContent ?? '';
}

function settingsText(tab: string): string {
  chooseFromMore('Settings');
  settingsTab(tab);
  return screen.getByRole('dialog', { name: 'Settings' }).textContent ?? '';
}

function deleteAllText(): string {
  savingSettings();
  fireEvent.click(screen.getByRole('button', { name: 'Delete all saved reviews' }));
  return screen.getByRole('alertdialog').textContent ?? '';
}

describe('with the save picker (Chrome, Edge)', () => {
  it('the Save menu offers "Overwrite the original" with the no-backup note, and no backup promise', () => {
    platform.capabilities = PICKER;
    renderShell(makeController().controller);
    const text = saveMenuText();
    expect(screen.getByRole('radio', { name: /Overwrite the original/ })).toBeTruthy();
    expect(text).toContain(NO_BACKUP);
    expect(text).not.toMatch(/keeps a backup|\.bak/);
  });

  it('Settings › Saving’s Overwrite promises no .bak backup', () => {
    platform.capabilities = PICKER;
    renderShell(makeController().controller);
    const dialog = savingSettings();
    expect(screen.getByRole('checkbox', { name: 'Overwrite the original instead of saving a new copy (no backup on the web)' })).toBeTruthy();
    expect(dialog.textContent).not.toContain('.bak');
  });
});

describe('without the save picker (a download)', () => {
  it('the Save menu has no Overwrite', () => {
    platform.capabilities = DOWNLOAD;
    renderShell(makeController({ overwrite: true }).controller);
    saveMenuText();
    expect(screen.queryByRole('radio', { name: /Overwrite/ })).toBeNull();
    expect((screen.getByRole('radio', { name: /New copy/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('Settings › Saving has no Overwrite', () => {
    platform.capabilities = DOWNLOAD;
    renderShell(makeController().controller);
    savingSettings();
    expect(screen.queryByRole('checkbox', { name: /Overwrite/ })).toBeNull();
  });
});

describe('the web’s wording', () => {
  it('About: the text never leaves this browser, and no "never connects to the internet"', async () => {
    platform.capabilities = PICKER;
    renderShell(makeController().controller);
    const text = await aboutText();
    expect(text).toContain(
      'Your text never leaves this browser. The app’s own files load from this site, which may check for a newer version.',
    );
    expect(text).not.toContain('never connects to the internet');
    expect(text).not.toContain('Check for updates');
  });

  it('the start screen: the writing never leaves this browser, not "this PC"', () => {
    platform.capabilities = PICKER;
    renderShell(makeController().controller);
    const text = document.querySelector('.empty-state')!.textContent ?? '';
    expect(text).toContain('Works offline after the first visit. Your writing never leaves this browser.');
    expect(text).not.toContain('this PC');
  });

  it('Modules: saved reviews are kept in this browser', () => {
    platform.capabilities = PICKER;
    renderShell(makeController().controller);
    const text = settingsText('Modules');
    expect(text).toContain('A small record per review, kept in this browser.');
    expect(text).not.toContain('this computer');
  });

  it('Delete all saved reviews: from this browser', () => {
    platform.capabilities = PICKER;
    renderShell(makeController().controller);
    const text = deleteAllText();
    expect(text).toContain('deleted from this browser');
    expect(text).not.toContain('this computer');
  });

  it('Reading without an offline voice: the system’s speech settings, not Windows Settings', () => {
    platform.capabilities = PICKER;
    renderShell(makeController().controller);
    const text = settingsText('Reading');
    expect(text).toContain('Install an offline voice in your system’s speech settings.');
    expect(text).not.toContain('Windows Settings');
  });
});

describe('the desktop keeps its wording', () => {
  it('Save menu and Settings › Saving: Overwrite keeps a backup', () => {
    platform.capabilities = DESKTOP;
    renderShell(makeController().controller);
    const text = saveMenuText();
    expect(text).toContain('Overwrite (keeps a backup)');
    expect(text).not.toContain(NO_BACKUP);
    savingSettings();
    expect(screen.getByRole('checkbox', { name: /keeps a \.bak backup/ })).toBeTruthy();
  });

  it('About says Kashiro never connects to the internet', async () => {
    platform.capabilities = DESKTOP;
    renderShell(makeController().controller);
    expect(await aboutText()).toContain('Kashiro never connects to the internet');
  });

  it('the start screen: the writing never leaves this PC', () => {
    platform.capabilities = DESKTOP;
    renderShell(makeController().controller);
    expect(document.querySelector('.empty-state')!.textContent).toContain('Works offline. Your writing never leaves this PC.');
  });

  it('Modules, Delete all and Reading name this computer and Windows Settings', () => {
    platform.capabilities = DESKTOP;
    renderShell(makeController().controller);
    expect(settingsText('Modules')).toContain('A small file per review in the app’s own folder on this computer.');
    expect(settingsText('Reading')).toContain('Windows Settings');
    expect(deleteAllText()).toContain('deleted from this computer');
  });
});
