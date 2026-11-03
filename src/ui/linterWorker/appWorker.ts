import type { WorkerLike } from './workerLinter';

/**
 * A new Worker running Harper (harperWorker.ts); both platforms start theirs here so Vite sees one Worker entry.
 * The cast: WorkerLike's handlers take the one field they read (`data`), while a real Worker's take a full MessageEvent.
 */
export const appWorker = (): WorkerLike =>
  new Worker(new URL('./harperWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
