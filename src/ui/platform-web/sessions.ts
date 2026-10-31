import type { SessionFiles } from '../state/sessionStore';
import { storage } from './storage';

/** One saved review in the `sessions` store: its JSON and when it was last written (ms since 1970). */
interface StoredReview {
  json: string;
  savedAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The saved reviews in the browser's storage (platform-web/storage.ts), with the desktop's contract. */
export const sessionFiles = {
  save: async (key, json) => {
    const review: StoredReview = { json, savedAt: Date.now() };
    await (await storage()).put('sessions', key, review);
  },
  load: async (key) => (await (await storage()).get<StoredReview>('sessions', key))?.json ?? null,
  list: async () => {
    const entries = await (await storage()).entries<StoredReview>('sessions');
    return { sessions: entries.map(([key, review]) => ({ key, json: review.json })), problems: [] };
  },
  delete: async (key) => {
    await (await storage()).delete('sessions', key);
  },
  prune: async (keepDays) => {
    const store = await storage();
    const oldest = Date.now() - keepDays * DAY_MS;
    const entries = await store.entries<StoredReview>('sessions');
    // keepDays 0 deletes every review, including one saved this millisecond.
    const expired = entries.filter(([, review]) => keepDays === 0 || review.savedAt < oldest);
    await Promise.all(expired.map(([key]) => store.delete('sessions', key)));
  },
} satisfies SessionFiles;
