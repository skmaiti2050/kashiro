import type { CloseRequest } from '../platform/window';

/** A browser tab is shown as soon as it loads: nothing to do. */
export async function showMainWindow(): Promise<void> {}

/** The tab's title. */
export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
}

/**
 * Calls `handler` when the user leaves the page (closes the tab, reloads, navigates away). A browser waits for no
 * async handler: only a `preventDefault` before the handler's first await counts, and it makes the browser show its
 * own "Leave site?" prompt. Returns the unsubscribe function.
 */
export async function onWindowCloseRequested(handler: (request: CloseRequest) => Promise<void>): Promise<() => void> {
  const listener = (event: BeforeUnloadEvent) => {
    void handler({
      preventDefault: () => {
        event.preventDefault();
        // Older Chrome and Safari ask only when returnValue is set too.
        event.returnValue = true;
      },
    });
  };
  window.addEventListener('beforeunload', listener);
  return () => window.removeEventListener('beforeunload', listener);
}

/** A page can't close a tab the user opened; the tab stays as it is. */
export async function closeWindow(): Promise<void> {}
