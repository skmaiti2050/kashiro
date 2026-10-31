import { useEffect } from 'react';
import { capabilities } from './platform/capabilities';
import { showMainWindow } from './platform/window';
import { rememberWindowPlacement } from './platform/windowPlacement';

/**
 * At most this long after the first render, the window counts as drawn even if no animation frame came: WebView2
 * may pause them while the window is hidden, which would leave it hidden until the Rust safety net (5 s).
 */
const DRAWN_AT_LATEST_MS = 80;

/** At most this long, the window waits for its saved place; a slow or stuck restore must not keep it hidden. */
const PLACED_AT_LATEST_MS = 500;

/**
 * The window starts hidden (tauri.conf.json). This puts it back where it was last time (F22 item 5), then shows it
 * once it is both placed and drawn (two animation frames), so it neither shows blank white (Task U3 item 1) nor
 * appears in one place and jumps to another (F26 item 4).
 */
export function useShowWindowWhenDrawn(): void {
  useEffect(() => {
    // Without window memory (the web) there is no place to restore.
    const placement = capabilities.windowMemory ? rememberWindowPlacement() : { restored: Promise.resolve(), stop: () => {} };
    let drawn = false;
    let placed = false;
    let shown = false;
    const showWhenReady = () => {
      if (shown || !drawn || !placed) return;
      shown = true;
      // Nothing on screen can say it yet; the Rust safety net shows the window within 5 s anyway.
      showMainWindow().catch((e: unknown) => console.error('Could not show the window:', e));
    };
    const markDrawn = () => {
      drawn = true;
      showWhenReady();
    };
    const markPlaced = () => {
      placed = true;
      showWhenReady();
    };
    void placement.restored.then(markPlaced);
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(markDrawn)));
    const drawnAtLatest = setTimeout(markDrawn, DRAWN_AT_LATEST_MS);
    const placedAtLatest = setTimeout(markPlaced, PLACED_AT_LATEST_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(drawnAtLatest);
      clearTimeout(placedAtLatest);
      placement.stop();
    };
  }, []);
}
