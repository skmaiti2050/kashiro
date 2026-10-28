/**
 * Paste with no text on the clipboard (Task F18): an image, a file copied in Explorer, or nothing at all
 * shows a notice and leaves the open document as it is. A refused clipboard still opens an empty document
 * to paste into with Ctrl+V, and text opens as before.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { makeController, noFiles, warmLinter } from './harness';
import { openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const NO_TEXT = 'The clipboard has no text to check. To check a Word file, use Open.';

beforeAll(warmLinter);
afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
});

/** A clipboard whose readText gives `read` (Chromium reads an image or a copied file as ''). */
function clipboardReading(read: () => Promise<string>) {
  const readText = vi.fn(read);
  Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
  return readText;
}

/** The toolbar's Paste, waiting until the clipboard has been read and its result shown. */
async function pressPaste(readText: ReturnType<typeof clipboardReading>) {
  await act(async () => fireEvent.click(within(screen.getByRole('toolbar', { name: 'Document' })).getByRole('button', { name: 'Paste' })));
  await waitFor(() => expect(readText).toHaveBeenCalledTimes(1));
}

describe('Paste with no text on the clipboard', () => {
  it('an image only (read as ""): the notice, announced, and no document opens', async () => {
    const readText = clipboardReading(async () => '');
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    await pressPaste(readText);
    const status = await waitFor(() => screen.getByText(NO_TEXT));
    expect(status.closest('[role="status"]')).not.toBeNull();
    expect(controller.getState().document).toBeNull();
    expect(controller.getState().opening).toBeNull();
  });

  it('whitespace only: the notice, and the open document stays as it was', async () => {
    const readText = clipboardReading(async () => ' \r\n\t ');
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const before = controller.getState().document;
    await pressPaste(readText);
    await screen.findByText(NO_TEXT);
    expect(controller.getState().document).toBe(before);
    expect(controller.getState().phase).toBe('ready');
  });

  it('with unsaved work, Paste asks first; after Discard the notice shows and the document and its change stay', async () => {
    const readText = clipboardReading(async () => '');
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const before = controller.getState().document;
    const first = controller.getState().session!.decisions().top[0];
    act(() => controller.accept(first.id));
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Document' })).getByRole('button', { name: 'Paste' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Unsaved changes' });
    expect(readText).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' })));
    await screen.findByText(NO_TEXT);
    expect(controller.getState().document).toBe(before);
    expect(controller.hasUnsavedWork()).toBe(true);
  });
});

describe('Paste as before', () => {
  it('reading the clipboard refused: an empty document to paste into, and no notice', async () => {
    const readText = clipboardReading(async () => {
      throw new DOMException('Read permission denied.', 'NotAllowedError');
    });
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    await pressPaste(readText);
    await waitFor(() => expect(controller.getState().phase).toBe('ready'), { timeout: 10000 });
    expect(controller.getState().document).toMatchObject({ name: 'Untitled.txt', text: '' });
    expect(screen.queryByText(NO_TEXT)).toBeNull();
  });

  it('text: opened as a new document', async () => {
    const readText = clipboardReading(async () => 'The cat sat on the mat.');
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    await pressPaste(readText);
    await waitFor(() => expect(controller.getState().phase).toBe('ready'), { timeout: 10000 });
    expect(controller.getState().document).toMatchObject({ name: 'Untitled.txt', text: 'The cat sat on the mat.' });
    expect(screen.queryByText(NO_TEXT)).toBeNull();
  });
});
