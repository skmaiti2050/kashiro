// Settings in tabs (F22 item 6 of the F21 list): the ARIA tabs pattern, and the last tab remembered.
import { describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { makeController } from './harness';
import { chooseFromMore, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const TABS = ['Reading', 'Checking', 'Saving', 'Modules', 'Language'];

const settings = () => screen.getByRole('dialog', { name: 'Settings' });
const tabs = () => within(settings()).getAllByRole('tab');
const selected = () => tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')!;
const panel = () => within(settings()).getByRole('tabpanel');

function openSettings() {
  renderShell(makeController().controller);
  chooseFromMore('Settings');
}

describe('Settings tabs', () => {
  it('a labelled tablist of five tabs; one panel, labelled by its tab, with roving tabindex', () => {
    openSettings();
    expect(within(settings()).getByRole('tablist', { name: 'Settings sections' })).toBeTruthy();
    expect(tabs().map((tab) => tab.textContent)).toEqual(TABS);
    expect(selected().textContent).toBe('Reading');
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(panel().getAttribute('aria-labelledby')).toBe(selected().id);
    expect(selected().getAttribute('aria-controls')).toBe(panel().id);
    expect(within(panel()).getByRole('combobox', { name: 'Theme' })).toBeTruthy();
    expect(within(settings()).queryByRole('combobox', { name: 'App language' })).toBeNull();
  });

  it('arrow keys move and select (wrapping); Home and End jump; a click selects', () => {
    openSettings();
    tabs()[0].focus();
    fireEvent.keyDown(tabs()[0], { key: 'ArrowRight' });
    expect(selected().textContent).toBe('Checking');
    expect(document.activeElement).toBe(selected());
    expect(within(panel()).getByRole('combobox', { name: 'Default English variant' })).toBeTruthy();
    fireEvent.keyDown(selected(), { key: 'End' });
    expect(selected().textContent).toBe('Language');
    fireEvent.keyDown(selected(), { key: 'ArrowRight' });
    expect(selected().textContent).toBe('Reading');
    fireEvent.keyDown(selected(), { key: 'ArrowLeft' });
    expect(selected().textContent).toBe('Language');
    expect(within(panel()).getByRole('combobox', { name: 'App language' })).toBeTruthy();
    fireEvent.keyDown(selected(), { key: 'Home' });
    expect(selected().textContent).toBe('Reading');
    expect(document.activeElement).toBe(selected());
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    fireEvent.click(within(settings()).getByRole('tab', { name: 'Saving' }));
    expect(selected().textContent).toBe('Saving');
  });

  it('remembers the last tab when Settings opens again, also after a restart', () => {
    openSettings();
    fireEvent.click(within(settings()).getByRole('tab', { name: 'Modules' }));
    fireEvent.click(within(settings()).getByRole('button', { name: 'Close' }));
    chooseFromMore('Settings');
    expect(selected().textContent).toBe('Modules');
    expect(within(panel()).getByRole('group', { name: 'Modules' })).toBeTruthy();
    // A new app window (a restart) opens on the same tab.
    cleanup();
    openSettings();
    expect(selected().textContent).toBe('Modules');
  });
});
