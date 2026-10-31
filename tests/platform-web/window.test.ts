// @vitest-environment jsdom
// Web Task 3 (controller ruling 1): leaving the page with unsaved work. A browser waits for no async handler before a
// tab goes, so the close request is answered synchronously in beforeunload: preventDefault there makes the browser
// show its own "Leave site?" prompt, and nothing is asked when the handler doesn't call it.
import { describe, expect, it } from 'vitest';
import { onWindowCloseRequested } from '@/ui/platform-web/window';

function leavePage(): Event {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('leaving the page', () => {
  it('a handler that keeps the page makes the browser ask: preventDefault, synchronously', async () => {
    const stop = await onWindowCloseRequested(async (request) => request.preventDefault());
    expect(leavePage().defaultPrevented).toBe(true);
    stop();
  });

  it('a handler that lets the page go: no prompt', async () => {
    const stop = await onWindowCloseRequested(async () => {});
    expect(leavePage().defaultPrevented).toBe(false);
    stop();
  });

  it('after unsubscribing, leaving asks nothing', async () => {
    (await onWindowCloseRequested(async (request) => request.preventDefault()))();
    expect(leavePage().defaultPrevented).toBe(false);
  });
});
