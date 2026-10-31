import { getCurrentWindow } from '@tauri-apps/api/window';

/** A request to close the window; `preventDefault` keeps it open. */
export interface CloseRequest {
  preventDefault(): void;
}

/** Shows the window, which starts hidden (tauri.conf.json) until the app has drawn and placed it. */
export function showMainWindow(): Promise<void> {
  return getCurrentWindow().show();
}

export function setWindowTitle(title: string): Promise<void> {
  return getCurrentWindow().setTitle(title);
}

/** Calls `handler` when the user closes the window; Tauri waits for it before closing. Returns the unsubscribe function. */
export function onWindowCloseRequested(handler: (request: CloseRequest) => Promise<void>): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(handler);
}

/** Closes the window without asking again (after the unsaved-changes dialog said so). */
export function closeWindow(): Promise<void> {
  return getCurrentWindow().destroy();
}
