// Final review item 5: About is loaded on demand. After another tab applied an update, the old page's About chunk
// is gone from the server and the cache; opening About must then say to reload, never unmount the document.
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { Capabilities } from '@/ui/platform/capabilities';
import { makeController } from './harness';
import { chooseFromMore, openAndWait, renderShell } from './shell';

const WEB: Capabilities = { ai: false, windowMemory: false, updates: false, textDrop: true, saveInPlace: 'picker', web: true };

const platform = vi.hoisted(() => ({ capabilities: {} as Capabilities }));
vi.mock('@/ui/platform/capabilities', () => platform);
vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);
// What a browser does for a chunk that is no longer there.
vi.mock('@/ui/AboutDialog', () => {
  throw new TypeError('Failed to fetch dynamically imported module: https://example.github.io/kashiro/assets/AboutDialog-old.js');
});

describe('About’s chunk is missing', () => {
  it('says to reload, and the document stays', async () => {
    platform.capabilities = WEB;
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('She recieved the letter.'));
    chooseFromMore('About');
    expect(await screen.findByText('Reload the page to open About: this page is from an earlier version of Kashiro.')).toBeTruthy();
    expect(document.querySelector('.document .cm-content')?.textContent).toContain('She recieved the letter.');
  });
});
