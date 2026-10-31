// A stub: the web build has no window memory (capabilities.windowMemory is false), so the app never calls this.
// Same exports as src/ui/platform/windowPlacement.ts.
export const SAVE_AFTER_MS = 500;

export function rememberWindowPlacement(): { restored: Promise<void>; stop: () => void } {
  throw new Error('not available on the web yet');
}
