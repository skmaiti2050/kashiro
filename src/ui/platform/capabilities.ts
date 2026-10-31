/**
 * What this platform can do; the UI hides the items it can't (web design: "feature flags come from the platform").
 * The web build's twin is src/ui/platform-web/capabilities.ts.
 */
export interface Capabilities {
  /** AI rewrites (the local writing helper and its model file). */
  ai: boolean;
  /** The window's size and place are remembered between runs. */
  windowMemory: boolean;
  /** "Check for updates" (the Releases page). */
  updates: boolean;
  /** Text dragged from another app can be dropped on the page (WebView2 under Tauri drops files only). */
  textDrop: boolean;
  /** How Save writes: the desktop's own dialog and commands, the browser's save picker, or a download. */
  saveInPlace: 'native' | 'picker' | 'download';
  /** The web build (About marks it as a preview). */
  web: boolean;
}

export const capabilities: Capabilities = { ai: true, windowMemory: true, updates: true, textDrop: false, saveInPlace: 'native', web: false };
