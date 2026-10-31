// Web Task 2: Settings › Saving on the web says where settings are kept and offers Export / Import dictionary
// (kashiro-dictionary.json, {"version":1,"words":[…]}); Import adds each word with the dictionary's add rule.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Capabilities } from '@/ui/platform/capabilities';
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

const WEB_NOTE = 'Settings, your dictionary and saved reviews are kept in this browser. Clearing the browser’s site data deletes them.';

function openSavingSettings(dictionary: string[] = []) {
  const result = makeController({ dictionary });
  const { unmount } = renderShell(result.controller);
  chooseFromMore('Settings');
  settingsTab('Saving');
  return { ...result, unmount };
}

/** Captures the files a click on Export downloads (jsdom has no object URLs and doesn't download). */
function catchDownloads() {
  const downloads: { name: string; blob: Blob }[] = [];
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url: string) => void blobs.delete(url);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: blobs.get(this.href)! });
  });
  return downloads;
}

async function importFile(text: string) {
  const input = screen.getByLabelText('Import dictionary', { selector: 'input' });
  const file = new File([text], 'kashiro-dictionary.json', { type: 'application/json' });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

describe('Settings › Saving on the web', () => {
  beforeEach(() => {
    platform.capabilities = WEB;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  it('says where settings are kept', () => {
    openSavingSettings();
    expect(screen.getByText(WEB_NOTE)).toBeTruthy();
  });

  it('Export then Import round-trips the dictionary', async () => {
    const downloads = catchDownloads();
    const exporting = openSavingSettings(['cutover', 'ARN', 'DBInstances']);
    fireEvent.click(screen.getByRole('button', { name: 'Export dictionary' }));
    expect(downloads.map((d) => d.name)).toEqual(['kashiro-dictionary.json']);
    const text = await downloads[0].blob.text();
    expect(JSON.parse(text)).toEqual({ version: 1, words: ['cutover', 'ARN', 'DBInstances'] });

    exporting.unmount();
    const { saved } = openSavingSettings();
    await importFile(text);
    await waitFor(() => expect(saved.at(-1)?.dictionary).toEqual(['cutover', 'ARN', 'DBInstances']));
  });

  it('Import adds each word with the add rule: "Cutover" is stored as "cutover"', async () => {
    const { saved } = openSavingSettings(['ARN']);
    await importFile(JSON.stringify({ version: 1, words: ['Cutover'] }));
    await waitFor(() => expect(saved.at(-1)?.dictionary).toEqual(['ARN', 'cutover']));
    expect(screen.getByText('Imported 1 word')).toBeTruthy();
  });

  // Final review item 9: the count is the dictionary's growth, not the file's length.
  it('Import counts only the words it added: one already there and one repeated are not counted', async () => {
    const { saved } = openSavingSettings(['ARN']);
    await importFile(JSON.stringify({ version: 1, words: ['ARN', 'cutover', 'Cutover'] }));
    await waitFor(() => expect(saved.at(-1)?.dictionary).toEqual(['ARN', 'cutover']));
    expect(screen.getByText('Imported 1 word')).toBeTruthy();
  });

  it('a file that is not a Kashiro dictionary changes nothing and says so', async () => {
    const { saved } = openSavingSettings(['ARN']);
    await importFile('{"words": "ARN"}');
    expect(await screen.findByText(/This file isn’t a Kashiro dictionary/)).toBeTruthy();
    expect(saved).toEqual([]);
  });
});

describe('Settings › Saving on the desktop', () => {
  it('has no web note and no Export / Import dictionary', () => {
    platform.capabilities = DESKTOP;
    openSavingSettings();
    expect(screen.queryByText(WEB_NOTE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export dictionary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import dictionary' })).toBeNull();
  });
});
