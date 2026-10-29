import { isTauri } from '@tauri-apps/api/core';
import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize, type Monitor, type Window } from '@tauri-apps/api/window';
import { load, type Store } from '@tauri-apps/plugin-store';
import { restorePlan, type ScreenArea, type WindowPlacement } from '../state/windowPlacement';

/** Its own store file, beside settings.json: a per-PC detail, not a setting. */
const STORE_FILE = 'window.json';
const KEY = 'placement';
/** Moving or resizing sends many events: the placement is saved once they pause this long. */
export const SAVE_AFTER_MS = 500;

const workAreaOf = (monitor: Monitor): ScreenArea => {
  const area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
  return { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height };
};

/**
 * Remember the window (F22 item 5): puts the window back where it was at the last close (its size, place and
 * maximised state; centred when that place is on no monitor now), then saves it whenever it moves or resizes.
 * The window starts hidden and is shown once `restored` settles (F26 item 4). `restored` never rejects: a failed
 * restore is logged. Outside Tauri (tests, a browser) it does nothing.
 */
export function rememberWindowPlacement(): { restored: Promise<void>; stop: () => void } {
  if (!isTauri()) return { restored: Promise.resolve(), stop: () => {} };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unlisteners: (() => void)[] = [];

  /** Puts the window back as `store` holds it; returns the normal bounds it restored, if it placed the window. */
  const restore = async (appWindow: Window, store: Store): Promise<WindowPlacement | null> => {
    const plan = restorePlan(await store.get<WindowPlacement>(KEY), (await availableMonitors()).map(workAreaOf));
    if (!plan) return null;
    await appWindow.setSize(new PhysicalSize(plan.width, plan.height));
    let normal: WindowPlacement | null = null;
    if (plan.position) {
      await appWindow.setPosition(new PhysicalPosition(plan.position.x, plan.position.y));
      normal = { ...plan.position, width: plan.width, height: plan.height, maximized: false };
    } else {
      await appWindow.center();
    }
    if (plan.maximized) await appWindow.maximize();
    return normal;
  };

  let placed = () => {};
  const restored = new Promise<void>((resolve) => (placed = resolve));

  const start = async () => {
    const appWindow = getCurrentWindow();
    const store = await load(STORE_FILE, { autoSave: false, defaults: {} });
    // A failed restore isn't fatal: the window stays where Windows put it, and the listeners below still save the
    // next move over the bad placement (Task F24, F23 review M-39).
    /** The last normal (not maximised) bounds; kept while maximised, so they are what is saved. */
    let normal = await restore(appWindow, store).catch((e: unknown) => {
      console.error('Could not restore the window placement:', e);
      return null;
    });
    placed();

    const save = async () => {
      if (await appWindow.isMinimized()) return;
      const maximized = await appWindow.isMaximized();
      if (!maximized || !normal) {
        const [position, size] = await Promise.all([appWindow.outerPosition(), appWindow.innerSize()]);
        normal = { x: position.x, y: position.y, width: size.width, height: size.height, maximized: false };
      }
      await store.set(KEY, { ...normal, maximized });
      await store.save();
    };
    const saveSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void save().catch((e: unknown) => console.error('Could not save the window placement:', e)), SAVE_AFTER_MS);
    };
    for (const listening of [appWindow.onMoved(saveSoon), appWindow.onResized(saveSoon)]) {
      const unlisten = await listening;
      if (stopped) unlisten();
      else unlisteners.push(unlisten);
    }
  };

  // Not fatal: the window opens where Windows puts it.
  start()
    .catch((e: unknown) => console.error('Could not remember the window placement:', e))
    .finally(placed);
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    unlisteners.forEach((unlisten) => unlisten());
  };
  return { restored, stop };
}
