// Remember the window (F22 item 5) through the platform module: the round trip across a restart, and the
// off-screen fallback, over a fake Tauri window and store.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => {
  const handlers: Record<'moved' | 'resized', (() => void) | null> = { moved: null, resized: null };
  const store = new Map<string, unknown>();
  const window = {
    position: { x: 100, y: 80 },
    size: { width: 1200, height: 800 },
    maximized: false,
    calls: [] as string[],
    failSetSize: false,
  };
  const monitors = [{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } } }];
  return { handlers, store, window, monitors };
});

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-store', () => ({
  load: async () => ({
    get: async (key: string) => fake.store.get(key),
    set: async (key: string, value: unknown) => void fake.store.set(key, structuredClone(value)),
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
  const w = fake.window;
  return {
    PhysicalSize,
    PhysicalPosition,
    availableMonitors: async () => fake.monitors,
    getCurrentWindow: () => ({
      outerPosition: async () => ({ ...w.position }),
      innerSize: async () => ({ ...w.size }),
      isMaximized: async () => w.maximized,
      isMinimized: async () => false,
      setPosition: async (p: { x: number; y: number }) => {
        w.calls.push(`setPosition ${p.x},${p.y}`);
        w.position = { x: p.x, y: p.y };
      },
      setSize: async (s: { width: number; height: number }) => {
        if (w.failSetSize) throw new Error('invalid size');
        w.calls.push(`setSize ${s.width}x${s.height}`);
        w.size = { width: s.width, height: s.height };
      },
      maximize: async () => {
        w.calls.push('maximize');
        w.maximized = true;
      },
      center: async () => void w.calls.push('center'),
      onMoved: async (handler: () => void) => {
        fake.handlers.moved = handler;
        return () => (fake.handlers.moved = null);
      },
      onResized: async (handler: () => void) => {
        fake.handlers.resized = handler;
        return () => (fake.handlers.resized = null);
      },
    }),
  };
});

const { rememberWindowPlacement, SAVE_AFTER_MS } = await import('@/ui/platform/windowPlacement');

/** One app run: restores, then the user moves the window to `position` and gives it `size`. */
async function run(change?: { position?: { x: number; y: number }; size?: { width: number; height: number }; maximized?: boolean }) {
  const stop = rememberWindowPlacement();
  await vi.waitFor(() => expect(fake.handlers.moved).not.toBeNull());
  if (change) {
    Object.assign(fake.window, { ...(change.position && { position: change.position }), ...(change.size && { size: change.size }) });
    if (change.maximized !== undefined) fake.window.maximized = change.maximized;
    fake.handlers.moved!();
    fake.handlers.resized!();
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS + 10);
  }
  stop();
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.store.clear();
  Object.assign(fake.window, { position: { x: 100, y: 80 }, size: { width: 1200, height: 800 }, maximized: false, calls: [], failSetSize: false });
});

describe('the window placement across restarts', () => {
  it('first run: nothing to restore, so the window is left where Windows put it', async () => {
    await run();
    expect(fake.window.calls).toEqual([]);
  });

  it('a moved and resized window comes back there after a restart', async () => {
    await run({ position: { x: 300, y: 200 }, size: { width: 1000, height: 700 } });
    fake.window.calls = [];
    await run();
    expect(fake.window.calls).toEqual(['setSize 1000x700', 'setPosition 300,200']);
  });

  it('a maximised window comes back maximised, over its last normal size and place', async () => {
    await run({ position: { x: 300, y: 200 }, size: { width: 1000, height: 700 } });
    await run({ position: { x: -8, y: -8 }, size: { width: 1936, height: 1056 }, maximized: true });
    fake.window.calls = [];
    fake.window.maximized = false;
    await run();
    expect(fake.window.calls).toEqual(['setSize 1000x700', 'setPosition 300,200', 'maximize']);
  });

  // Task F24 (F23 adversarial review M-39): a failed restore stopped the window being remembered for good.
  it('when the restore fails, moves are still saved, so the next start has a good placement', async () => {
    fake.store.set('placement', { x: 300, y: 200, width: 1000, height: 700, maximized: false });
    fake.window.failSetSize = true; // as Tauri does for a size it can't take
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run({ position: { x: 400, y: 250 }, size: { width: 1100, height: 750 } });
    expect(logged).toHaveBeenCalledWith('Could not restore the window placement:', expect.any(Error));
    logged.mockRestore();
    expect(fake.store.get('placement')).toEqual({ x: 400, y: 250, width: 1100, height: 750, maximized: false });
  });

  it('saved on a monitor that is gone: the window is centred instead', async () => {
    await run({ position: { x: 2200, y: 100 }, size: { width: 1000, height: 700 } });
    fake.window.calls = [];
    await run();
    expect(fake.window.calls).toEqual(['setSize 1000x700', 'center']);
  });
});
