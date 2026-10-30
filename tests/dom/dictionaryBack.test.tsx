// Task F28 item 2 (owner): the Dictionary panel opened from the link in Settings › Checking goes Back to Settings,
// on the Checking tab, with focus on that link (its button reads "Back"; Escape does the same). Settings stays open
// under it, inert, so its tab and scroll are as the user left them. From the ⋯ menu or the command palette the panel
// keeps Close, as before.
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { makeController } from './harness';
import { chooseFromMore, renderShell, settingsTab } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const dictionary = () => screen.getByRole('dialog', { name: 'Dictionary' });
const settings = () => screen.getByRole('dialog', { name: 'Settings' });
const link = () => within(settings()).getByRole('button', { name: /^Open the dictionary/ });
const selectedTab = () => within(settings()).getByRole('tab', { selected: true }).textContent;

/** Opens Settings › Checking and the Dictionary from its link. */
function openFromSettings() {
  renderShell(makeController({ dictionary: ['Nashik', 'Vantix'] }).controller);
  chooseFromMore('Settings');
  settingsTab('Checking');
  // A click focuses a button in Chromium (WebView2); jsdom's fireEvent doesn't, so focus it as the click would.
  link().focus();
  fireEvent.click(link());
}

describe('the Dictionary opened from Settings goes Back to Settings (F28 item 2)', () => {
  it('opens over Settings, which stays open under it, inert; its button reads Back, not Close', () => {
    openFromSettings();
    expect(settings().closest('[inert]')).not.toBeNull();
    expect(dictionary().closest('[inert]')).toBeNull();
    expect(within(dictionary()).getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(within(dictionary()).queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('Back returns to Settings on the Checking tab, with focus on the Dictionary link', () => {
    openFromSettings();
    fireEvent.click(within(dictionary()).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog', { name: 'Dictionary' })).toBeNull();
    expect(settings().closest('[inert]')).toBeNull();
    expect(selectedTab()).toBe('Checking');
    expect(document.activeElement).toBe(link());
  });

  it('Escape does the same, and does not close Settings with it', () => {
    openFromSettings();
    fireEvent.keyDown(within(dictionary()).getByRole('searchbox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Dictionary' })).toBeNull();
    expect(selectedTab()).toBe('Checking');
    expect(document.activeElement).toBe(link());
    // The next Escape closes Settings, as it always has.
    fireEvent.keyDown(link(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a word added there shows in the link’s count when back in Settings', async () => {
    openFromSettings();
    fireEvent.change(within(dictionary()).getByRole('textbox', { name: 'Add a word' }), { target: { value: 'Anjali' } });
    fireEvent.click(within(dictionary()).getByRole('button', { name: 'Add' }));
    await within(dictionary()).findByText('3 words');
    fireEvent.click(within(dictionary()).getByRole('button', { name: 'Back' }));
    expect(link().textContent).toBe('Open the dictionary (3 words)');
  });

  it('the page stays locked until the last of the two dialogs closes', () => {
    const page = document.documentElement;
    const before = page.style.overflow;
    openFromSettings();
    expect(page.style.overflow).toBe('hidden');
    fireEvent.click(within(dictionary()).getByRole('button', { name: 'Back' }));
    expect(page.style.overflow).toBe('hidden');
    fireEvent.click(within(settings()).getByRole('button', { name: 'Close' }));
    expect(page.style.overflow).toBe(before);
  });

  it('the Back label is translated: Hindi and Bengali', () => {
    const back = (language: string) => JSON.parse(readFileSync(`src/ui/i18n/${language}.json`, 'utf8'))['dialog.back'];
    expect([back('en'), back('hi'), back('bn')]).toEqual(['Back', 'वापस जाएँ', 'ফিরে যান']);
  });
});

describe('from the ⋯ menu or the command palette the Dictionary keeps Close', () => {
  it('⋯ › Dictionary…: Close, and Settings is not involved', () => {
    renderShell(makeController().controller);
    chooseFromMore('Dictionary…');
    expect(within(dictionary()).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(dictionary()).queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(within(dictionary()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the command palette: Close', () => {
    renderShell(makeController().controller);
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    const box = within(screen.getByRole('dialog', { name: 'Command palette' })).getByRole('combobox');
    fireEvent.change(box, { target: { value: 'dictionary' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(within(dictionary()).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(dictionary()).queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('after Back to Settings and closing it, ⋯ › Dictionary… has Close again', () => {
    openFromSettings();
    fireEvent.click(within(dictionary()).getByRole('button', { name: 'Back' }));
    fireEvent.click(within(settings()).getByRole('button', { name: 'Close' }));
    chooseFromMore('Dictionary…');
    expect(within(dictionary()).getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
