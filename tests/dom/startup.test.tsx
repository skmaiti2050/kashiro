/**
 * Start-up (Task U3 item 1): the window starts hidden (tauri.conf.json) and the app shows it once its first
 * frame is drawn, so no blank white window appears; "Starting…" shows only when loading takes over 300 ms.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { act, render, screen } from '@testing-library/react';

const show = vi.fn(async () => {});
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => () => {}, destroy: async () => {}, show }),
}));
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
// Settings that never finish loading: the app stays on its start-up screen.
vi.mock('@/ui/platform/settings', () => ({ loadSettings: () => new Promise(() => {}), saveSettings: async () => {} }));
vi.mock('@/ui/platform/helper', () => ({ helperInstalled: () => new Promise(() => {}) }));

import App from '@/ui/App';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks(); // the spies on requestAnimationFrame and console.error
  show.mockClear();
});

describe('start-up', () => {
  it('the window is created hidden', () => {
    const conf = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8'));
    expect(conf.app.windows[0].visible).toBe(false);
  });

  it('the page has the theme background before any script runs (light and dark)', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    expect(html).toMatch(/<meta name="color-scheme" content="light dark"/);
    expect(html).toMatch(/background:\s*#fbfaf8/);
    expect(html).toMatch(/prefers-color-scheme:\s*dark[^}]*\{[^}]*background:\s*#1b1d20/);
  });

  it('shows the window after its first frame, once', async () => {
    vi.useFakeTimers();
    render(<App />);
    expect(show).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(100); // two animation frames
    });
    expect(show).toHaveBeenCalledTimes(1);
  });

  // Task U3 fix 1: WebView2 may pause animation frames while the window is hidden, which left it hidden until
  // the Rust safety net 5 s later.
  it('shows the window after a short timer when no animation frame comes', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    render(<App />);
    await act(async () => {
      vi.advanceTimersByTime(99);
    });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('shows the window once when both the frames and the timer fire', async () => {
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('a refused show() is reported in the log, not left unhandled (the Rust safety net still shows the window)', async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    show.mockRejectedValueOnce(new Error('window is gone'));
    render(<App />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0])).toMatch(/window is gone/);
  });

  it('"Starting…" appears only when loading takes longer than 300 ms', async () => {
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByText('Starting…')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText('Starting…')).toBeTruthy();
  });
});
