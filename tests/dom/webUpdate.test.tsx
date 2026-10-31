// Web Task 5: "Preview" and the build date in the status bar and About; the update notice ("Updated. Reload when you're
// ready"), which reloads only on its Reload button; the loading screen's progress line.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Capabilities } from '@/ui/platform/capabilities';
import { LoadingScreen } from '@/ui/web/LoadingScreen';
import { makeController } from './harness';
import { chooseFromMore, renderShell } from './shell';

const WEB: Capabilities = { ai: false, windowMemory: false, updates: false, textDrop: true, saveInPlace: 'download', web: true };

const platform = vi.hoisted(() => ({ capabilities: {} as Capabilities, update: null as (() => void) | null }));
vi.mock('@/ui/platform/capabilities', () => ({ capabilities: platform.capabilities }));
vi.mock('@/ui/platform/updates', () => ({ useUpdateReady: () => platform.update }));
vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const NOTICE = 'Updated. Reload when you’re ready';

beforeEach(() => {
  Object.assign(platform.capabilities, WEB);
  platform.update = null;
  vi.stubEnv('VITE_BUILD_DATE', '2026-10-31');
});

afterEach(() => vi.unstubAllEnvs());

describe('the web preview', () => {
  it('the status bar says Preview with the build date', () => {
    renderShell(makeController().controller);
    expect(screen.getByRole('contentinfo').textContent).toContain('Preview · built 2026-10-31');
  });

  it('About shows the build date', async () => {
    renderShell(makeController().controller);
    chooseFromMore('About');
    const about = await screen.findByRole('dialog', { name: 'About Kashiro' });
    expect(about.textContent).toContain('Built 2026-10-31');
  });

  it('the desktop status bar has no Preview', () => {
    Object.assign(platform.capabilities, { ...WEB, web: false });
    renderShell(makeController().controller);
    expect(screen.getByRole('contentinfo').textContent).not.toContain('Preview');
  });
});

describe('the update notice', () => {
  it('shows nothing while there is no new version', () => {
    renderShell(makeController().controller);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('a new version shows the notice with Reload, and nothing reloads until it is clicked', () => {
    const reload = vi.fn();
    platform.update = reload;
    renderShell(makeController().controller);
    expect(screen.getByText(NOTICE).closest('[role="status"]')).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stays while the user works: it has no timer', () => {
    vi.useFakeTimers();
    try {
      platform.update = vi.fn();
      renderShell(makeController().controller);
      act(() => vi.advanceTimersByTime(60 * 60 * 1000));
      expect(screen.getByText(NOTICE)).toBeTruthy();
      expect(platform.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the loading screen', () => {
  it('counts the megabytes downloaded', () => {
    render(<LoadingScreen megabytes={7} />);
    expect(screen.getByText('Loading the proofreader… 7 MB')).toBeTruthy();
  });

  it('without a size, shows an indeterminate bar', () => {
    render(<LoadingScreen megabytes={null} />);
    expect(screen.getByText('Loading the proofreader…')).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.hasAttribute('value')).toBe(false);
  });
});
