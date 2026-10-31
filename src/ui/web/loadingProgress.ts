const MEGABYTE = 1024 * 1024;

/**
 * Downloads `url` to the end, calling `onProgress` with the whole megabytes received each time that number grows
 * (0 first), or once with null where the body can't be read as a stream (the screen then shows an indeterminate bar).
 * The bytes are not kept: this warms the cache that Harper's own fetch of the same URL is then served from.
 */
export async function downloadWithProgress(
  url: string,
  onProgress: (megabytes: number | null) => void,
  fetcher: (url: string) => Promise<Response> = fetch,
): Promise<void> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Couldn’t download ${url}: the server answered ${response.status}.`);
  if (!response.body) {
    onProgress(null);
    await response.arrayBuffer();
    return;
  }
  const reader = response.body.getReader();
  let bytes = 0;
  let shown = 0;
  onProgress(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    bytes += value.byteLength;
    const megabytes = Math.floor(bytes / MEGABYTE);
    if (megabytes > shown) {
      shown = megabytes;
      onProgress(megabytes);
    }
  }
}
