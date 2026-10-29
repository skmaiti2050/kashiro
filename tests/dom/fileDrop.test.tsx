// Task F21b item 9 (owner, F21 list item 13): a .docx, .md or .txt file dropped on the window opens, with the
// unsaved-work prompt first. A file Kashiro can't open says so at once: no prompt, nothing read, the document kept.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { DroppedFile } from '@/ui/platform/files';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

/** The app's drop listener, as the shell subscribed it. */
const drop = vi.hoisted(() => ({ listener: null as ((files: DroppedFile[]) => void) | null }));
vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => ({
  ...(await import('./platformMocks')).platformFiles,
  onFileDrop: async (listener: (files: DroppedFile[]) => void) => {
    drop.listener = listener;
    return () => {};
  },
}));
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** A dropped file; `reads` counts how often its bytes were read. */
function dropped(name: string, text = 'The cat sat on the mat.') {
  const file = {
    name,
    reads: 0,
    read: async () => {
      file.reads++;
      return { name, path: `C:/docs/${name}`, bytes: new TextEncoder().encode(text) };
    },
  };
  return file;
}

async function withUnsavedWork() {
  const { controller } = makeController();
  renderShell(controller);
  await openAndWait(controller, () => controller.openText('I recieve mail today.'));
  fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
  expect(controller.hasUnsavedWork()).toBe(true);
  return controller;
}

describe('dropping a file on the window (Task F21b item 9)', () => {
  it('a .md file: the unsaved-work prompt comes first, nothing is read until Discard, then it opens', async () => {
    const controller = await withUnsavedWork();
    const notes = dropped('notes.md');
    act(() => drop.listener!([notes]));

    const dialog = screen.getByRole('alertdialog', { name: 'Unsaved changes' });
    expect(notes.reads).toBe(0);
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: /Discard/ })));
    await waitFor(() => expect(controller.getState().document?.name).toBe('notes.md'));
    expect(notes.reads).toBe(1);
  });

  it('Cancel in the prompt keeps the document and reads nothing', async () => {
    const controller = await withUnsavedWork();
    const notes = dropped('notes.txt');
    act(() => drop.listener!([notes]));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Cancel' }));
    expect(notes.reads).toBe(0);
    expect(controller.getState().document?.name).toBe('Untitled.txt');
  });

  it('a file Kashiro can’t open: no prompt, nothing read, the document kept, and the error says which formats open', async () => {
    const controller = await withUnsavedWork();
    const photo = dropped('photo.png');
    act(() => drop.listener!([photo]));
    expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' })).toBeNull();
    expect(photo.reads).toBe(0);
    expect(controller.getState().document?.name).toBe('Untitled.txt');
    expect(screen.getByRole('alert').textContent).toContain('Can’t open photo.png: Kashiro opens .docx, .txt and .md files.');
  });

  it('several files: the first one Kashiro can open', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await act(async () => {});
    const report = dropped('report.docx.zip');
    const notes = dropped('notes.txt', 'Hello there.');
    act(() => drop.listener!([report, notes]));
    await waitFor(() => expect(controller.getState().document?.name).toBe('notes.txt'));
    expect(report.reads).toBe(0);
  });
});
