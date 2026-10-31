// Web Task 5: the loading screen counts the megabytes of Harper's wasm as they arrive (fetch streams), or shows an
// indeterminate bar where the response can't be read as a stream.
import { describe, it, expect, vi } from 'vitest';
import { downloadWithProgress } from '@/ui/web/loadingProgress';

const MEGABYTE = 1024 * 1024;

/** A response whose body arrives in chunks of `chunk` bytes, `total` bytes in all. */
function streamed(total: number, chunk: number): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) return controller.close();
      const size = Math.min(chunk, total - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return new Response(body);
}

describe('downloadWithProgress', () => {
  it('reports each whole megabyte once as the body streams in', async () => {
    const seen: (number | null)[] = [];
    await downloadWithProgress('/kashiro/assets/harper.wasm', (megabytes) => seen.push(megabytes), async () => streamed(2.5 * MEGABYTE, MEGABYTE / 2));
    expect(seen).toEqual([0, 1, 2]);
  });

  it('fetches the URL it is given', async () => {
    const fetcher = vi.fn(async () => streamed(10, 10));
    await downloadWithProgress('/kashiro/assets/harper.wasm', () => {}, fetcher);
    expect(fetcher).toHaveBeenCalledWith('/kashiro/assets/harper.wasm');
  });

  it('without a readable stream, reports no size (an indeterminate bar) and still finishes', async () => {
    const seen: (number | null)[] = [];
    const response = new Response(null);
    await downloadWithProgress('/x.wasm', (megabytes) => seen.push(megabytes), async () => response);
    expect(seen).toEqual([null]);
  });

  it('a failed download says which status came back', async () => {
    await expect(downloadWithProgress('/x.wasm', () => {}, async () => new Response('', { status: 404 }))).rejects.toThrow(/404/);
  });
});
