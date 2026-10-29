/**
 * Task F26 item 4: the window flickered at start (it appeared centred, or on the other screen, then jumped to its
 * saved place) because it was shown after its first frame, before the saved placement was put back. Now the
 * placement comes first and the window is shown after it; a restore that hangs shows the window anyway at 500 ms.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';

const fake = vi.hoisted(() => ({
  calls: [] as string[],
  /** When set, reading the saved placement never finishes (a stuck store). */
  hangStore: false,
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-store', () => ({
  load: async () => ({
    get: (key: string) => (fake.hangStore ? new Promise(() => {}) : Promise.resolve(key === 'placement' ? { x: 300, y: 200, width: 1000, height: 700, maximized: false } : undefined)),
    set: async () => {},
    save: async () => {},
  }),
}));
vi.mock('@tauri-apps/api/window', () => {
  class PhysicalSize {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
  }
  class PhysicalPosition {
    constructor(
      readonly x: number,
      readonly y: number,
    ) {}
  }
  const monitor = { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } } };
  // Each call takes a few milliseconds, as an IPC round trip does: longer than the first frame.
  const slowly = (call: string) => new Promise<void>((resolve) => setTimeout(() => resolve(void fake.calls.push(call)), 30));
  return {
    PhysicalSize,
    PhysicalPosition,
    availableMonitors: async () => [monitor],
    getCurrentWindow: () => ({
      setSize: (s: PhysicalSize) => slowly(`setSize ${s.width}x${s.height}`),
      setPosition: (p: PhysicalPosition) => slowly(`setPosition ${p.x},${p.y}`),
      center: () => slowly('center'),
      maximize: () => slowly('maximize'),
      show: async () => void fake.calls.push('show'),
      onMoved: async () => () => {},
      onResized: async () => () => {},
    }),
  };
});

const { useShowWindowWhenDrawn } = await import('@/ui/useShowWindowWhenDrawn');

function Shell() {
  useShowWindowWhenDrawn();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.calls = [];
  fake.hangStore = false;
});
afterEach(() => vi.useRealTimers());

describe('the window is placed, then shown (F26 item 4)', () => {
  it('the saved size and place are applied before show()', async () => {
    render(<Shell />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fake.calls).toEqual(['setSize 1000x700', 'setPosition 300,200', 'show']);
  });

  it('a restore that hangs still shows the window, at about 500 ms', async () => {
    fake.hangStore = true;
    render(<Shell />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(fake.calls).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fake.calls).toEqual(['show']);
  });
});
