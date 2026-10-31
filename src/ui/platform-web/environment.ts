// A stub until the web adapters land (web plan, Task 2+): same exports as src/ui/platform/environment.ts.
export async function environmentVersions(): Promise<{ windows: string | null; webView2: string | null }> {
  throw new Error('not available on the web yet');
}
