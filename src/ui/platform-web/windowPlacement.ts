import type * as desktop from '../platform/windowPlacement';

// The browser places its own window (capabilities.windowMemory is false): nothing to restore or save.
export const SAVE_AFTER_MS: typeof desktop.SAVE_AFTER_MS = 500;

export const rememberWindowPlacement: typeof desktop.rememberWindowPlacement = () => ({ restored: Promise.resolve(), stop() {} });
