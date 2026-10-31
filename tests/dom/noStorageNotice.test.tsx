// Web Task 2 (Review focus 1): when the browser keeps nothing, at the start or once writes start failing, the app
// says so once with a notice that stays until dismissed. The platform reports the loss (onStorageLost).
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { createLinter } from '@/engine/linter';
import { SessionController } from '@/ui/state/sessionController';
import { defaultSettings } from '@/ui/state/settings';
import { noFiles } from './harness';
import { renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const NOTICE = 'This browser isn’t keeping Kashiro’s settings; they last until you close the tab.';

/** A controller whose platform reports a storage loss through the returned `lose`. */
function controllerWithStorage(lostAtStart: boolean) {
  let listener: (() => void) | null = null;
  const controller = new SessionController({
    files: noFiles,
    settings: defaultSettings('en-US'),
    saveSettings: async () => {},
    createLinter: (variant, words) => createLinter(variant, words),
    onStorageLost: (onLost) => {
      if (lostAtStart) onLost();
      else listener = onLost;
    },
  });
  return { controller, lose: () => listener?.() };
}

describe('the no-storage notice', () => {
  it('shows at the start when the browser keeps nothing, and stays until dismissed', async () => {
    vi.useFakeTimers();
    try {
      renderShell(controllerWithStorage(true).controller);
      expect(screen.getByText(NOTICE)).toBeTruthy();
      await act(async () => vi.advanceTimersByTime(10_000)); // longer than an ordinary notice lasts
      expect(screen.getByText(NOTICE)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('shows when storage is lost during the session, and not before', () => {
    const { controller, lose } = controllerWithStorage(false);
    renderShell(controller);
    expect(screen.queryByText(NOTICE)).toBeNull();
    act(() => lose());
    expect(screen.getAllByText(NOTICE)).toHaveLength(1);
  });
});
