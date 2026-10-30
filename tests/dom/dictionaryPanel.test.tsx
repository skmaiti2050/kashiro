// The Dictionary panel (F22 item 1; F21 list items 5 and G): ⋯ › Dictionary…, a sorted, searchable list with a
// count, Remove, Add and Merge duplicates. Settings keeps only a link to it.
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { makeController } from './harness';
import { chooseFromMore, renderShell, settingsTab } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

// No title-case entry: the controller lowercases those on load (Task F29).
const OWNER = ['NASHIK', 'vantix', 'VPC', 'VANTIX', 'ami', 'vpc', 'DBInstances'];

const panel = () => screen.getByRole('dialog', { name: 'Dictionary' });
const words = () => within(within(panel()).getByRole('list')).queryAllByRole('listitem').map((li) => li.querySelector('[lang]')!.textContent);

function openDictionary(dictionary = OWNER) {
  const result = makeController({ dictionary });
  renderShell(result.controller);
  const more = screen.getByRole('button', { name: 'More' });
  more.focus();
  chooseFromMore('Dictionary…');
  return { ...result, more };
}

describe('Dictionary panel', () => {
  it('opens from ⋯ with a heading, a count and the words sorted case-insensitively; Close returns focus to ⋯', () => {
    const { more } = openDictionary();
    expect(within(panel()).getByRole('heading', { name: 'Dictionary' })).toBeTruthy();
    expect(within(panel()).getByText('7 words')).toBeTruthy();
    expect(words()).toEqual(['ami', 'vantix', 'VANTIX', 'DBInstances', 'NASHIK', 'VPC', 'vpc']);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('the labelled search filters as you type, ignoring case; no match says so', () => {
    openDictionary();
    const search = within(panel()).getByRole('searchbox', { name: 'Search the dictionary' });
    fireEvent.change(search, { target: { value: 'CRA' } });
    expect(words()).toEqual(['vantix', 'VANTIX']);
    expect(within(panel()).getByText('7 words')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(words()).toEqual([]);
    expect(within(panel()).getByText('No words match.')).toBeTruthy();
  });

  it('Remove takes the word out (saved), and focus stays in the list', async () => {
    const { saved } = openDictionary();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Remove NASHIK' }));
    await waitFor(() => expect(words()).not.toContain('NASHIK'));
    expect(saved.at(-1)!.dictionary).toEqual(['vantix', 'VPC', 'VANTIX', 'ami', 'vpc', 'DBInstances']);
    expect(within(panel()).getByText('6 words')).toBeTruthy();
    expect(panel().contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.tagName).toBe('BUTTON');
  });

  it('Add uses the dictionary’s add rule: a lowercase word replaces its other cases', async () => {
    const { saved } = openDictionary(['NASHIK', 'UBUNTU']);
    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Add a word' }), { target: { value: 'ubuntu' } });
    await act(async () => fireEvent.click(within(panel()).getByRole('button', { name: 'Add' })));
    expect(saved.at(-1)!.dictionary).toEqual(['NASHIK', 'ubuntu']);
    expect(words()).toEqual(['NASHIK', 'ubuntu']);
    expect((within(panel()).getByRole('textbox', { name: 'Add a word' }) as HTMLInputElement).value).toBe('');
  });

  it('Merge duplicates keeps the lowercase forms, says how many it merged, then is disabled', async () => {
    const { saved } = openDictionary();
    const merge = within(panel()).getByRole('button', { name: 'Merge duplicates' }) as HTMLButtonElement;
    expect(merge.disabled).toBe(false);
    await act(async () => fireEvent.click(merge));
    expect(saved.at(-1)!.dictionary).toEqual(['NASHIK', 'vantix', 'vpc', 'ami', 'DBInstances']);
    expect(words()).toEqual(['ami', 'vantix', 'DBInstances', 'NASHIK', 'vpc']);
    expect(within(panel()).getByRole('status').textContent).toBe('Merged 2 duplicates.');
    expect((within(panel()).getByRole('button', { name: 'Merge duplicates' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Settings › Checking has no word list, only a link that opens the panel', () => {
    renderShell(makeController({ dictionary: OWNER }).controller);
    chooseFromMore('Settings');
    settingsTab('Checking');
    expect(screen.queryByRole('button', { name: 'Remove NASHIK' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open the dictionary (7 words)' }));
    // Settings stays open under the panel, inert, for Back (F28 item 2: dictionaryBack.test.tsx).
    expect(screen.getByRole('dialog', { name: 'Settings' }).closest('[inert]')).not.toBeNull();
    expect(panel()).toBeTruthy();
  });
});
