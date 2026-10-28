/** Chromium's scheduler.yield (WebView2 has it): resumes as soon as the input and paint waiting are done. */
interface Scheduler {
  yield(): Promise<void>;
}

/**
 * Lets the browser handle waiting clicks, keys, scrolling and painting before the caller goes on (a long check
 * between two chunks, Task F20 item 6). Where scheduler.yield is missing, a message to itself: a macrotask
 * without setTimeout's 4 ms clamp (and one fake timers leave alone).
 */
export function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Partial<Scheduler> }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });
}
