/**
 * A new version waiting to take over: its Reload action, else null. The desktop app updates through GitHub Releases
 * (About › Check for updates), so nothing ever waits here.
 */
export function useUpdateReady(): (() => void) | null {
  return null;
}
