import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * At most this long after the first render, the window is shown even if no animation frame came: WebView2 may
 * pause them while the window is hidden, which would leave it hidden until the Rust safety net (5 s).
 */
const SHOW_AT_LATEST_MS = 80;

/**
 * Shows the window, which starts hidden (tauri.conf.json), once the first frame is drawn (two animation frames)
 * or SHOW_AT_LATEST_MS have passed, whichever comes first: it never shows blank white (Task U3 item 1).
 */
export function useShowWindowWhenDrawn(): void {
  useEffect(() => {
    let shown = false;
    const showOnce = () => {
      if (shown) return;
      shown = true;
      // Nothing on screen can say it yet; the Rust safety net shows the window within 5 s anyway.
      getCurrentWindow()
        .show()
        .catch((e: unknown) => console.error('Could not show the window:', e));
    };
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(showOnce)));
    const atLatest = setTimeout(showOnce, SHOW_AT_LATEST_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(atLatest);
    };
  }, []);
}
