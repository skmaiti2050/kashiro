// Remember the window (F22 item 5): whether the change log is open, across restarts.
import { describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { makeController } from './harness';
import { renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const logToggle = () => screen.getByRole('button', { name: /Change log/ });

describe('the change log, open or closed, across restarts', () => {
  it('closed at first; opened, it is open after a restart; closed again, it stays closed', () => {
    renderShell(makeController().controller);
    expect(logToggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(logToggle());
    cleanup();

    renderShell(makeController().controller);
    expect(logToggle().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(logToggle());
    cleanup();

    renderShell(makeController().controller);
    expect(logToggle().getAttribute('aria-expanded')).toBe('false');
  });
});
