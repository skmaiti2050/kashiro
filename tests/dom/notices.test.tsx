/**
 * Notices and the document can be closed (Task U3 item 5): every banner has a ×, a notice also clears on its
 * own after a few seconds, an error stays until dismissed, and Close document (Ctrl+W) returns to the start.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { makeController, noFiles, warmLinter } from './harness';
import { openAndWait, renderShell } from './shell';
import { msg } from '@/ui/i18n/message';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);
afterEach(() => vi.useRealTimers());

describe('banners', () => {
  it('an error stays until its × is pressed', async () => {
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    await act(() => controller.openFile({ name: 'bad.docx', path: '/d/bad.docx', bytes: new TextEncoder().encode('not a zip') }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Can’t open bad\.docx/);
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(alert.textContent).toMatch(/Can’t open bad\.docx/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(alert.textContent).toBe('');
  });

  it('a notice clears on its own after a few seconds, or at once with its ×', async () => {
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    // Fake time for the notice's own timer: a real 6 s wait timed out under the full suite's load.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(() => controller.save().then(() => {}));
    expect(screen.getByText(/^Saved as /)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss this message' })).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText(/^Saved as /)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByText(/^Saved as /)).toBeNull();

    await act(() => controller.save().then(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByText(/^Saved as /)).toBeNull();
  });

  // Task U3 fix 1: changes left out of the saved file must not go unseen.
  it('"Saved, but N changes couldn’t be placed" stays until its × is pressed', async () => {
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    vi.useFakeTimers();
    act(() => controller.showNotice(msg('notice.savedUnplaced', { saved: msg('notice.saved', { path: '/d/a.checked.docx' }), count: 2 })));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText(/2 changes couldn’t be placed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByText(/2 changes couldn’t be placed/)).toBeNull();
  });

  // #34: the user believes the Apply worked, so 6 s (easily missed while typing) is too short.
  it('"That fix wasn’t applied" stays until its × is pressed', async () => {
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    vi.useFakeTimers();
    act(() => controller.showNotice(msg('notice.applyLostToTyping')));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText(/That fix wasn’t applied/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByText(/That fix wasn’t applied/)).toBeNull();
  });
});

// #39: an applied AI rewrite taken back by a re-check is told, and the notice is not missed.
describe('banners: a dropped AI rewrite', () => {
  it('"An AI rewrite you applied was taken back" stays until its × is pressed', async () => {
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    vi.useFakeTimers();
    act(() => controller.showNotice(msg('notice.rewriteDropped')));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText(/An AI rewrite you applied was taken back/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByText(/An AI rewrite you applied was taken back/)).toBeNull();
  });
});

describe('Close document', () => {
  it('Ctrl+W closes the document and the start screen comes back', async () => {
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    await waitFor(() => expect(controller.getState().document).toBeNull());
    expect(screen.getByRole('button', { name: /Try a sample/ })).toBeTruthy();
  });

  it('with unsaved work, Ctrl+W asks first; Cancel keeps the document', async () => {
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const first = controller.getState().session!.decisions().top[0];
    act(() => controller.accept(first.id));
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    const dialog = await screen.findByRole('alertdialog', { name: 'Unsaved changes' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(controller.getState().document).not.toBeNull();
  });
});

