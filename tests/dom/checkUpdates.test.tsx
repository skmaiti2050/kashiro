// F23 item 4 (list item 20): "Check for updates" in ⋯ and in About opens the project's Releases page in the browser,
// only on that click. Nothing checks on its own: no page is opened at start or with a document open.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, openAndWait, renderShell } from './shell';

const opened = vi.hoisted(() => ({ pages: [] as string[], fail: false }));
vi.mock('@/ui/platform/links', () => ({
  openProjectPage: async (page: string) => {
    if (opened.fail) throw new Error('no browser');
    opened.pages.push(page);
  },
}));
vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** ⋯ › Check for updates…, waiting for the page to be asked for (inside one act() the menu would not open in time). */
async function checkFromMore(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Check for updates…' })));
}

describe('Check for updates (F23 item 4)', () => {
  it('⋯ › Check for updates opens the Releases page, and nothing opens before the click', async () => {
    opened.pages = [];
    opened.fail = false;
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('We was late.'));
    expect(opened.pages).toEqual([]);
    await checkFromMore();
    expect(opened.pages).toEqual(['releases']);
  });

  it('About has a Check for updates button that opens the same page', async () => {
    opened.pages = [];
    opened.fail = false;
    renderShell(makeController().controller);
    chooseFromMore('About');
    const dialog = await screen.findByRole('dialog', { name: 'About Kashiro' });
    expect(opened.pages).toEqual([]);
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Check for updates' })));
    expect(opened.pages).toEqual(['releases']);
  });

  it('says so when the browser could not be opened', async () => {
    opened.pages = [];
    opened.fail = true;
    renderShell(makeController().controller);
    await checkFromMore();
    expect(screen.getByRole('alert').textContent).toMatch(/couldn’t open the browser/i);
  });
});
