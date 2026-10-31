import type { CloseRequest } from '../platform/window';

/** A browser tab is shown as soon as it loads: nothing to do. */
export async function showMainWindow(): Promise<void> {}

/** The tab's title. */
export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
}

/**
 * Not subscribed yet: a browser can't wait for an async handler before a tab closes (beforeunload is synchronous),
 * so the web's unsaved-work guard needs its own design.
 */
export async function onWindowCloseRequested(_handler: (request: CloseRequest) => Promise<void>): Promise<() => void> {
  return () => {};
}

/** A page can't close a tab the user opened; the tab stays as it is. */
export async function closeWindow(): Promise<void> {}
