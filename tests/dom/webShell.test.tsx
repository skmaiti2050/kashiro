// Web Task 3: the app shell over the web's own files and window modules. Text dropped on the page opens as a new
// document (after the unsaved-work prompt, as Paste); a text or file Kashiro can't take says so and keeps the open
// document. Leaving the page with unsaved work makes the browser ask "Leave site?" (controller ruling 1); without
// unsaved work nothing asks, and Kashiro's own Save/Discard dialog never follows the browser's prompt.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Capabilities } from '@/ui/platform/capabilities';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

const platform = vi.hoisted(() => ({
  capabilities: { ai: false, windowMemory: false, updates: false, textDrop: true, saveInPlace: 'download', web: true } satisfies Capabilities,
}));
vi.mock('@/ui/platform/capabilities', () => platform);
vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', () => import('@/ui/platform-web/files'));
vi.mock('@/ui/platform/window', () => import('@/ui/platform-web/window'));
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** Drops `files` and/or plain `text` on the page, as the browser fires it. */
function dropOnPage({ files = [], text = '' }: { files?: File[]; text?: string }): void {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, getData: (type: string) => (type === 'text/plain' ? text : '') } });
  act(() => void document.body.dispatchEvent(event));
}

async function withUnsavedWork() {
  const { controller } = makeController();
  renderShell(controller);
  await openAndWait(controller, () => controller.openText('I recieve mail today.'));
  fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
  expect(controller.hasUnsavedWork()).toBe(true);
  return controller;
}

describe('dropping text on the page', () => {
  it('opens the text as a new document', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await act(async () => {});
    dropOnPage({ text: 'The cat sat on the mat.' });
    await waitFor(() => expect(controller.getState().phase).toBe('ready'), { timeout: 10000 });
    expect(controller.getState().document).toMatchObject({ name: 'Untitled.txt', text: 'The cat sat on the mat.' });
  });

  it('with unsaved work, the prompt comes first; Discard opens the text', async () => {
    const controller = await withUnsavedWork();
    dropOnPage({ text: 'The dog sat on the rug.' });
    const dialog = screen.getByRole('alertdialog', { name: 'Unsaved changes' });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: /Discard/ })));
    await waitFor(() => expect(controller.getState().document?.text).toBe('The dog sat on the rug.'), { timeout: 10000 });
  });

  it('2.1 MB of text: the too-large notice, and the open document stays', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const before = controller.getState().document;
    dropOnPage({ text: 'a'.repeat(2_100_000) });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Untitled.txt is too large to check (2.1 MB'));
    expect(controller.getState().document).toBe(before);
  });

  it('a .pdf: the unsupported notice, and the open document stays', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const before = controller.getState().document;
    dropOnPage({ files: [new File(['%PDF-1.7'], 'brief.pdf')] });
    expect(screen.getByRole('alert').textContent).toContain('Can’t open brief.pdf: Kashiro opens .docx, .txt and .md files.');
    expect(controller.getState().document).toBe(before);
  });

  it('a .md file opens under its name, which is its path on the web', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await act(async () => {});
    dropOnPage({ files: [new File(['The cat sat on the mat.'], 'notes.md')] });
    await waitFor(() => expect(controller.getState().document).toMatchObject({ name: 'notes.md', path: 'notes.md' }), { timeout: 10000 });
  });
});

describe('leaving the page', () => {
  function leavePage(): Event {
    const event = new Event('beforeunload', { cancelable: true });
    act(() => void window.dispatchEvent(event));
    return event;
  }

  it('with unsaved work: the browser asks, and Kashiro’s own dialog doesn’t follow', async () => {
    await withUnsavedWork();
    expect(leavePage().defaultPrevented).toBe(true);
    await act(async () => {});
    expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' })).toBeNull();
  });

  it('without unsaved work: nothing asks', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    expect(controller.hasUnsavedWork()).toBe(false);
    expect(leavePage().defaultPrevented).toBe(false);
  });
});
