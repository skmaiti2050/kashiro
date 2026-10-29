/**
 * The window's size, place and maximised state, kept across restarts (F22 item 5). Physical pixels, as Tauri
 * reports them; x and y are the outer top-left corner, width and height the inner size (what setSize sets).
 * When maximised, the bounds are the last normal ones, so un-maximising after a restart goes back there.
 */
export interface WindowPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** A monitor's work area (without the taskbar), in physical pixels. */
export interface ScreenArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What to do at start: the size, the place (null: centre it) and whether to maximise. */
export interface RestorePlan {
  width: number;
  height: number;
  position: { x: number; y: number } | null;
  maximized: boolean;
}

/** How much of the title bar must be on some monitor for the user to grab it: 100 px wide, 30 px tall. */
const GRAB_WIDTH = 100;
const GRAB_HEIGHT = 30;

/**
 * The window's minimum size, as in tauri.conf.json (minWidth, minHeight). Those are logical pixels; as a floor
 * for physical ones they only keep a corrupt size sane, and Windows applies the real minimum.
 */
export const MIN_WINDOW = { width: 760, height: 480 };

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isPlacement(saved: unknown): saved is WindowPlacement {
  if (typeof saved !== 'object' || saved === null) return false;
  const p = saved as Record<string, unknown>;
  return [p.x, p.y, p.width, p.height].every(isFiniteNumber) && (p.width as number) > 0 && (p.height as number) > 0 && typeof p.maximized === 'boolean';
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * `saved` in whole pixels, its size between the window minimum and the largest of `screens` (Task F24, F23 review
 * M-39): Tauri's setSize and setPosition take whole pixels only, and a hand-edited window.json may hold anything.
 */
function wholePixels(saved: WindowPlacement, screens: ScreenArea[]): WindowPlacement {
  const largest = { width: Math.max(...screens.map((s) => s.width)), height: Math.max(...screens.map((s) => s.height)) };
  return {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width: clamp(Math.round(saved.width), MIN_WINDOW.width, largest.width),
    height: clamp(Math.round(saved.height), MIN_WINDOW.height, largest.height),
    maximized: saved.maximized,
  };
}

/** True when enough of the title bar is on one of `screens` to grab it (a monitor unplugged leaves it off screen). */
function titleBarVisible(p: WindowPlacement, screens: ScreenArea[]): boolean {
  return screens.some((s) => {
    const wide = Math.min(p.x + p.width, s.x + s.width) - Math.max(p.x, s.x);
    const tall = Math.min(p.y + GRAB_HEIGHT, s.y + s.height) - Math.max(p.y, s.y);
    return wide >= GRAB_WIDTH && tall >= GRAB_HEIGHT;
  });
}

/**
 * The plan for `saved` on `screens`; null when nothing usable was saved, or no monitor is known to bound it
 * (Windows' own placement stays).
 */
export function restorePlan(saved: unknown, screens: ScreenArea[]): RestorePlan | null {
  if (!isPlacement(saved) || screens.length === 0) return null;
  const p = wholePixels(saved, screens);
  const position = titleBarVisible(p, screens) ? { x: p.x, y: p.y } : null;
  return { width: p.width, height: p.height, position, maximized: p.maximized };
}
