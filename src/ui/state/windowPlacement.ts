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

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isPlacement(saved: unknown): saved is WindowPlacement {
  if (typeof saved !== 'object' || saved === null) return false;
  const p = saved as Record<string, unknown>;
  return [p.x, p.y, p.width, p.height].every(isFiniteNumber) && (p.width as number) > 0 && (p.height as number) > 0 && typeof p.maximized === 'boolean';
}

/** True when enough of the title bar is on one of `screens` to grab it (a monitor unplugged leaves it off screen). */
function titleBarVisible(p: WindowPlacement, screens: ScreenArea[]): boolean {
  return screens.some((s) => {
    const wide = Math.min(p.x + p.width, s.x + s.width) - Math.max(p.x, s.x);
    const tall = Math.min(p.y + GRAB_HEIGHT, s.y + s.height) - Math.max(p.y, s.y);
    return wide >= GRAB_WIDTH && tall >= GRAB_HEIGHT;
  });
}

/** The plan for `saved` on `screens`; null when nothing usable was saved (Windows' own placement stays). */
export function restorePlan(saved: unknown, screens: ScreenArea[]): RestorePlan | null {
  if (!isPlacement(saved)) return null;
  const position = titleBarVisible(saved, screens) ? { x: saved.x, y: saved.y } : null;
  return { width: saved.width, height: saved.height, position, maximized: saved.maximized };
}
